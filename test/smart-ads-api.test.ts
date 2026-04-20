import test, { after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { sign } from "jsonwebtoken";
import { app } from "../src/server";
import { bciAttentionStore } from "../src/bci/AttentionStore";
import { SmartAdRequest } from "../src/smartads/types";

const JWT_SECRET = process.env["QUANTMAIL_JWT_SECRET"] ?? "dev-secret-change-in-production";

const makeToken = (sub = "smart-api-user"): string =>
  sign({ sub, iss: "quantmail" }, JWT_SECRET, { algorithm: "HS256", expiresIn: 3600 });

const makeRequest = (): SmartAdRequest => ({
  advertiserId: "adv-smart-api-001",
  campaignId: "cmp-smart-api-001",
  userId: "smart-api-user",
  placement: {
    platform: "quantedits",
    adFormat: "display",
    width: 720,
    height: 400,
    density: 2,
    deviceCategory: "desktop",
    placementPath: "/editor/render-export",
    viewabilityEstimate: 0.91,
    locale: "en-US",
    localHour: 16
  },
  audience: {
    verifiedLtv: 310,
    intentScore: 0.81,
    conversionRate: 0.36,
    attentionScore: 0.84,
    fatigueScore: 0.18,
    familiarityScore: 0.63,
    purchasePowerIndex: 0.72,
    recentWins: 3,
    recentLosses: 0,
    lastEmotion: "focused"
  },
  objectives: {
    primaryOutcome: "purchase",
    priority: "conversion",
    targetRoas: 2.8,
    budgetSensitivity: 0.33
  },
  product: {
    name: "Infinity Motion Preset Pack",
    brandName: "Quantads Studio",
    category: "creative-tools",
    price: 39,
    compareAtPrice: 79,
    currency: "USD",
    offerHeadline: "Motion presets for editors who move fast",
    offerBody: "Bring cinematic transitions, social-ready overlays, and export-safe templates into every cut.",
    destinationUrl: "https://quantads.example/motion-preset-pack",
    imageUrl: "https://cdn.quantads.example/motion-pack.png",
    valueProps: ["120 presets", "Template-safe exports", "One-click installs"],
    proofPoints: ["Verified editor workflows", "4.8/5 satisfaction", "Works across major NLEs"],
    badges: ["Launch week", "Trusted by creators"]
  },
  interaction: {
    focusDurationMs: 72_000,
    pointerEvents: 58,
    pointerSamples: [
      { dx: 4, dy: 3, dtMs: 12 },
      { dx: 7, dy: 2, dtMs: 16 },
      { dx: 5, dy: 1, dtMs: 18 }
    ],
    scrollDepth: 0.83,
    scrollSamples: [
      { offset: 240, velocity: 1.1, dwellMs: 2200 },
      { offset: 560, velocity: 0.7, dwellMs: 2600 },
      { offset: 860, velocity: 0.4, dwellMs: 2800 }
    ],
    keyEvents: 8,
    rageClicks: 0,
    copyPasteEvents: 1,
    hoverTargets: 5,
    formInteractions: 3,
    mediaPlayheadMs: 24_000
  },
  history: {
    recentImpressions: 3,
    recentClicks: 1,
    recentConversions: 1,
    priorAttentionDelta: 0.24,
    previousEmotion: "focused",
    dwellTrend: 0.18,
    averageScrollDepth: 0.73
  },
  environment: {
    contentGenre: "motion-design",
    sessionDepth: 7,
    culturalMoment: "creator-sale",
    soundtrackEnergy: 0.61
  }
});

test("POST /api/v1/smartads/emotion returns inferred emotion with auth", async () => {
  bciAttentionStore.ingest({
    userId: "smart-api-user",
    sessionId: "smart-session-1",
    platform: "quantedits",
    attentionScore: 0.88,
    engagementScore: 0.82,
    focusScore: 0.79,
    adExposureMs: 14_000
  });

  const server = app.listen(0);
  await once(server, "listening");

  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected numeric port");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/smartads/emotion`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${makeToken()}`
      },
      body: JSON.stringify(makeRequest())
    });

    assert.equal(response.status, 200);
    const body = await response.json() as {
      emotion: { primaryEmotion: string; confidence: number; explanation: string[] };
      meta: { engine: string; usedBciHistory: boolean };
    };

    assert.equal(body.emotion.primaryEmotion, "focused");
    assert.ok(body.emotion.confidence > 0.3);
    assert.ok(body.emotion.explanation.length >= 2);
    assert.match(body.meta.engine, /quantads-emotion/);
    assert.equal(body.meta.usedBciHistory, true);
  } finally {
    server.close();
  }
});

test("POST /api/v1/smartads/select chooses a creative and returns ranked options", async () => {
  const server = app.listen(0);
  await once(server, "listening");

  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected numeric port");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/smartads/select`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${makeToken()}`
      },
      body: JSON.stringify(makeRequest())
    });

    assert.equal(response.status, 200);
    const body = await response.json() as {
      decision: {
        selected: { creativeId: string; name: string };
        rankedOptions: Array<{ creativeId: string; normalizedScore: number; eligible: boolean }>;
        creativeStrategy: { ctaLabel: string };
        recommendedBidModifier: number;
      };
      meta: { rankedCandidates: number };
    };

    assert.match(body.decision.selected.creativeId, /cmp-smart-api-001/);
    assert.ok(body.decision.rankedOptions.length >= 4);
    assert.ok(body.decision.rankedOptions.every((option) => option.normalizedScore >= 0));
    assert.ok(body.decision.recommendedBidModifier > 0.8);
    assert.ok(body.decision.creativeStrategy.ctaLabel.length > 0);
    assert.equal(body.meta.rankedCandidates, body.decision.rankedOptions.length);
  } finally {
    server.close();
  }
});

test("POST /api/v1/smartads/render returns composition and render model", async () => {
  const server = app.listen(0);
  await once(server, "listening");

  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected numeric port");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/smartads/render`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${makeToken()}`
      },
      body: JSON.stringify(makeRequest())
    });

    assert.equal(response.status, 200);
    const body = await response.json() as {
      emotion: { primaryEmotion: string };
      decision: { selected: { creativeId: string } };
      composition: {
        layers: Array<{ layerId: string }>;
        operationLog: string[];
        ctaLabel: string;
        ariaLabel: string;
      };
      renderModel: {
        headline: string;
        ctaLabel: string;
        badges: Array<{ label: string }>;
        accessibility: { role: string; altText: string };
      };
      meta: { canvasOperations: number; engine: string };
    };

    assert.equal(body.emotion.primaryEmotion, "focused");
    assert.match(body.decision.selected.creativeId, /cmp-smart-api-001/);
    assert.ok(body.composition.layers.length >= 10);
    assert.ok(body.composition.operationLog.some((entry) => entry.startsWith("fillRect:")));
    assert.equal(body.renderModel.ctaLabel, body.composition.ctaLabel);
    assert.equal(body.renderModel.accessibility.role, "complementary");
    assert.ok(body.renderModel.badges.length >= 2);
    assert.match(body.meta.engine, /quantads-smart-renderer/);
    assert.ok(body.meta.canvasOperations >= body.composition.operationLog.length);
  } finally {
    server.close();
  }
});

test("POST /api/v1/smart-ads/render rejects invalid payloads", async () => {
  const server = app.listen(0);
  await once(server, "listening");

  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected numeric port");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/smartads/render`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${makeToken()}`
      },
      body: JSON.stringify({
        advertiserId: "adv-bad",
        campaignId: "cmp-bad",
        placement: { platform: "quantedits" }
      })
    });

    assert.equal(response.status, 422);
    const body = await response.json() as { error: string; details: string[] };
    assert.equal(body.error, "Validation failed");
    assert.ok(body.details.length > 0);
  } finally {
    server.close();
  }
});

test("POST /api/v1/smart-ads/select requires auth", async () => {
  const server = app.listen(0);
  await once(server, "listening");

  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected numeric port");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/smartads/select`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(makeRequest())
    });

    assert.equal(response.status, 401);
  } finally {
    server.close();
  }
});

after(() => {
  app.close();
});
