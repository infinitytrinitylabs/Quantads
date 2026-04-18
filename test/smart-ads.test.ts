/**
 * Tests for the Attention-Aware Smart Ads system:
 *   - EmotionDetector (unit)
 *   - AdaptiveCreativeEngine (unit)
 *   - CreativeComposer / AbTestTracker (unit)
 *   - SmartAdRenderer (unit)
 *   - HTTP routes via the app server (integration)
 */

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { sign } from "jsonwebtoken";
import { app } from "../src/server";
import { EmotionDetector } from "../src/services/EmotionDetector";
import { AdaptiveCreativeEngine } from "../src/services/AdaptiveCreativeEngine";
import { AbTestTracker, CreativeComposer, creativeComposer } from "../src/services/CreativeComposer";
import { SmartAdRenderer } from "../src/components/SmartAdRenderer";

// ─── Shared helpers ─────────────────────────────────────────────────────────

const JWT_SECRET = process.env["QUANTMAIL_JWT_SECRET"] ?? "dev-secret-change-in-production";

function makeToken(sub = "user-smart-ads-test", expiresIn = 3600): string {
  return sign({ sub, iss: "quantmail" }, JWT_SECRET, { algorithm: "HS256", expiresIn });
}

// ─── EmotionDetector unit tests ──────────────────────────────────────────────

test("EmotionDetector: default estimate is neutral with mid attention", () => {
  const det = new EmotionDetector({ updateIntervalMs: 999_999 });
  const est = det.getLatestEstimate();
  assert.equal(est.state, "neutral");
  assert.ok(est.attentionScore >= 0 && est.attentionScore <= 1);
  det.destroy();
});

test("EmotionDetector: fast scroll produces bored state", () => {
  const det = new EmotionDetector({ updateIntervalMs: 999_999 });
  for (let i = 0; i < 5; i++) {
    det.ingest({
      timestamp: Date.now() - i * 1000,
      scrollSpeed: 3000,
      clickErraticity: 0,
      dwellTimeSeconds: 0.5,
      idleSeconds: 1
    });
  }
  const est = det.computeNow();
  assert.equal(est.state, "bored");
  assert.ok(est.attentionScore < 0.5);
  det.destroy();
});

test("EmotionDetector: high click erraticity produces frustrated state", () => {
  const det = new EmotionDetector({ updateIntervalMs: 999_999 });
  for (let i = 0; i < 4; i++) {
    det.ingest({
      timestamp: Date.now() - i * 500,
      scrollSpeed: 200,
      clickErraticity: 0.9,
      dwellTimeSeconds: 2,
      idleSeconds: 0.5
    });
  }
  const est = det.computeNow();
  assert.equal(est.state, "frustrated");
  det.destroy();
});

test("EmotionDetector: long dwell time produces happy state", () => {
  const det = new EmotionDetector({ updateIntervalMs: 999_999 });
  for (let i = 0; i < 3; i++) {
    det.ingest({
      timestamp: Date.now() - i * 2000,
      scrollSpeed: 50,
      clickErraticity: 0.1,
      dwellTimeSeconds: 15,
      idleSeconds: 3
    });
  }
  const est = det.computeNow();
  assert.equal(est.state, "happy");
  assert.ok(est.attentionScore > 0.5);
  det.destroy();
});

test("EmotionDetector: ingestRaw derives bored from fast scroll", () => {
  const det = new EmotionDetector({ updateIntervalMs: 999_999 });
  // Needs at least 2 samples to produce a non-neutral estimate.
  // clickJitterMs is low (50ms) so erraticity = 50/300 ≈ 0.17, well below frustrated threshold.
  for (let i = 0; i < 3; i++) {
    det.ingestRaw({
      scrollDeltaPx: 6000,
      elapsedMs: 2000,
      clickCount: 2,
      clickJitterMs: 50,
      dwellTimeSeconds: 1,
      idleSeconds: 0.5
    });
  }
  const est = det.computeNow();
  // scroll speed = 6000/2000*1000 = 3000 px/s → bored
  assert.equal(est.state, "bored");
  det.destroy();
});

test("EmotionDetector: rolling window evicts old samples", () => {
  const det = new EmotionDetector({ windowMs: 1000, updateIntervalMs: 999_999 });
  det.ingest({
    timestamp: Date.now() - 5000,
    scrollSpeed: 100,
    clickErraticity: 0.95,
    dwellTimeSeconds: 1,
    idleSeconds: 0.5
  });
  det.ingest({
    timestamp: Date.now(),
    scrollSpeed: 100,
    clickErraticity: 0.1,
    dwellTimeSeconds: 3,
    idleSeconds: 2
  });
  const est = det.computeNow();
  assert.notEqual(est.state, "frustrated");
  det.destroy();
});

test("EmotionDetector: features are populated", () => {
  const det = new EmotionDetector({ updateIntervalMs: 999_999 });
  det.ingest({ timestamp: Date.now(), scrollSpeed: 500, clickErraticity: 0.2, dwellTimeSeconds: 5, idleSeconds: 2 });
  const est = det.computeNow();
  assert.ok(est.features.sampleCount >= 1);
  assert.ok(typeof est.features.meanScrollSpeed === "number");
  det.destroy();
});

// ─── AdaptiveCreativeEngine unit tests ──────────────────────────────────────

test("AdaptiveCreativeEngine: low attention produces attention-grabbing creative", () => {
  const eng = new AdaptiveCreativeEngine();
  const result = eng.selectVariant({
    campaignId: "cmp-test-001",
    attentionScore: 0.1,
    emotionalState: "neutral",
    context: "scrolling feed",
    deviceType: "mobile",
    localHour: 14
  });
  assert.ok(["fast", "medium"].includes(result.variant.animationSpeed));
  assert.ok(["bold-dark", "bold-light", "vibrant-gradient"].includes(result.variant.colorScheme));
});

test("AdaptiveCreativeEngine: high attention produces neutral-white scheme with slow animation", () => {
  const eng = new AdaptiveCreativeEngine();
  const result = eng.selectVariant({
    campaignId: "cmp-test-002",
    attentionScore: 0.9,
    emotionalState: "neutral",
    context: "reading article",
    deviceType: "desktop",
    localHour: 15
  });
  assert.equal(result.variant.colorScheme, "neutral-white");
  assert.equal(result.variant.animationSpeed, "slow");
});

test("AdaptiveCreativeEngine: bored state produces vibrant-gradient with fast animation", () => {
  const eng = new AdaptiveCreativeEngine();
  // Use desktop so the mobile-short-copy rule does not override animationSpeed
  const result = eng.selectVariant({
    campaignId: "cmp-test-003",
    attentionScore: 0.5,
    emotionalState: "bored",
    context: "scrolling",
    deviceType: "desktop",
    localHour: 16
  });
  assert.equal(result.variant.colorScheme, "vibrant-gradient");
  assert.equal(result.variant.animationSpeed, "fast");
});

test("AdaptiveCreativeEngine: late night produces calm-pastel with no animation", () => {
  const eng = new AdaptiveCreativeEngine();
  const result = eng.selectVariant({
    campaignId: "cmp-test-004",
    attentionScore: 0.5,
    emotionalState: "neutral",
    context: "browsing",
    deviceType: "mobile",
    localHour: 23
  });
  assert.equal(result.variant.colorScheme, "calm-pastel");
  assert.equal(result.variant.animationSpeed, "none");
});

test("AdaptiveCreativeEngine: previewAllLevels returns three distinct results", () => {
  const eng = new AdaptiveCreativeEngine();
  // Use neutral emotion at midday so no emotion/time rules override animation speed
  const preview = eng.previewAllLevels({
    campaignId: "cmp-preview-001",
    emotionalState: "neutral",
    context: "browsing",
    deviceType: "desktop",
    localHour: 15
  });
  assert.ok(preview.low);
  assert.ok(preview.medium);
  assert.ok(preview.high);
  // low (0.15) → fast animation; high (0.85) → slow animation
  assert.notEqual(preview.low.variant.animationSpeed, preview.high.variant.animationSpeed);
});

test("AdaptiveCreativeEngine: variant selection is deterministic", () => {
  const eng = new AdaptiveCreativeEngine();
  const input = {
    campaignId: "cmp-deterministic",
    attentionScore: 0.4,
    emotionalState: "neutral" as const,
    context: "browsing",
    deviceType: "desktop" as const,
    localHour: 12
  };
  const r1 = eng.selectVariant(input);
  const r2 = eng.selectVariant(input);
  assert.equal(r1.variant.variantId, r2.variant.variantId);
  assert.equal(r1.variant.colorScheme, r2.variant.colorScheme);
});

test("AdaptiveCreativeEngine: targeting rationale is non-empty", () => {
  const eng = new AdaptiveCreativeEngine();
  const result = eng.selectVariant({
    campaignId: "cmp-rationale",
    attentionScore: 0.6,
    emotionalState: "happy",
    context: "gaming",
    deviceType: "desktop",
    localHour: 18
  });
  assert.ok(result.variant.targetingRationale.length > 0);
});

test("AdaptiveCreativeEngine: frustrated state produces calm-pastel scheme", () => {
  const eng = new AdaptiveCreativeEngine();
  const result = eng.selectVariant({
    campaignId: "cmp-frustrated",
    attentionScore: 0.5,
    emotionalState: "frustrated",
    context: "support page",
    deviceType: "mobile",
    localHour: 14
  });
  assert.equal(result.variant.colorScheme, "calm-pastel");
});

test("AdaptiveCreativeEngine: result includes selectionRules array", () => {
  const eng = new AdaptiveCreativeEngine();
  const result = eng.selectVariant({
    campaignId: "cmp-rules",
    attentionScore: 0.3,
    emotionalState: "neutral",
    context: "reading",
    deviceType: "tablet",
    localHour: 9
  });
  assert.ok(Array.isArray(result.selectionRules));
  assert.ok(result.selectionRules.length > 0);
});

// ─── CreativeComposer unit tests ─────────────────────────────────────────────

test("CreativeComposer: composes banner-mobile with correct dimensions", () => {
  const eng = new AdaptiveCreativeEngine();
  const result = eng.selectVariant({
    campaignId: "cmp-banner-test",
    attentionScore: 0.5,
    emotionalState: "neutral",
    context: "feed",
    deviceType: "mobile",
    localHour: 14
  });
  const composed = creativeComposer.compose(result.variant, "banner-mobile");
  assert.equal(composed.format, "banner-mobile");
  assert.equal(composed.width, 320);
  assert.equal(composed.height, 50);
  assert.ok(composed.htmlPayload.length > 0);
  assert.ok(composed.drawLog.length > 0);
});

test("CreativeComposer: composes banner-leaderboard with correct dimensions", () => {
  const eng = new AdaptiveCreativeEngine();
  const result = eng.selectVariant({ campaignId: "cmp-leader", attentionScore: 0.5, emotionalState: "neutral", context: "feed", deviceType: "desktop", localHour: 14 });
  const composed = creativeComposer.compose(result.variant, "banner-leaderboard");
  assert.equal(composed.width, 728);
  assert.equal(composed.height, 90);
});

test("CreativeComposer: composes interstitial with correct dimensions", () => {
  const eng = new AdaptiveCreativeEngine();
  const result = eng.selectVariant({ campaignId: "cmp-inter", attentionScore: 0.3, emotionalState: "bored", context: "between videos", deviceType: "mobile", localHour: 20 });
  const composed = creativeComposer.compose(result.variant, "interstitial");
  assert.equal(composed.width, 375);
  assert.equal(composed.height, 667);
});

test("CreativeComposer: composes video-preroll with correct dimensions", () => {
  const eng = new AdaptiveCreativeEngine();
  const result = eng.selectVariant({ campaignId: "cmp-preroll", attentionScore: 0.8, emotionalState: "happy", context: "video", deviceType: "desktop", localHour: 19 });
  const composed = creativeComposer.compose(result.variant, "video-preroll");
  assert.equal(composed.width, 1280);
  assert.equal(composed.height, 720);
});

test("CreativeComposer: composeAllFormats returns all 5 formats", () => {
  const eng = new AdaptiveCreativeEngine();
  const result = eng.selectVariant({ campaignId: "cmp-all-formats", attentionScore: 0.5, emotionalState: "happy", context: "video watching", deviceType: "desktop", localHour: 12 });
  const comp = new CreativeComposer();
  const allFormats = comp.composeAllFormats(result.variant);
  const formats = Object.keys(allFormats);
  assert.ok(formats.includes("banner-mobile"));
  assert.ok(formats.includes("banner-leaderboard"));
  assert.ok(formats.includes("interstitial"));
  assert.ok(formats.includes("native"));
  assert.ok(formats.includes("video-preroll"));
});

test("CreativeComposer: HTML payload does not contain unescaped script tags", () => {
  const eng = new AdaptiveCreativeEngine();
  const result = eng.selectVariant({ campaignId: "cmp-xss-test", attentionScore: 0.5, emotionalState: "neutral", context: "test", deviceType: "mobile", localHour: 10 });
  const comp = new CreativeComposer();
  const composed = comp.compose(result.variant, "native");
  assert.ok(!composed.htmlPayload.includes("<script>"));
});

test("CreativeComposer: draw log contains expected operations", () => {
  const eng = new AdaptiveCreativeEngine();
  const result = eng.selectVariant({ campaignId: "cmp-drawlog", attentionScore: 0.5, emotionalState: "neutral", context: "test", deviceType: "desktop", localHour: 12 });
  const comp = new CreativeComposer();
  const composed = comp.compose(result.variant, "native");
  const ops = composed.drawLog.map((d) => d.op);
  assert.ok(ops.includes("fillRect"));
  assert.ok(ops.includes("fillText"));
});

// ─── AbTestTracker unit tests ────────────────────────────────────────────────

test("AbTestTracker: auto-pauses worst performer after 1000 impressions", () => {
  const tracker = new AbTestTracker(10);
  tracker.register("variant-A");
  tracker.register("variant-B");

  // Interleave impressions and clicks so CTR is accurate during auto-pause checks.
  // variant-A: 50 clicks / 1000 impressions = 5% CTR
  for (let i = 0; i < 1000; i++) {
    tracker.recordImpression("variant-A");
    if (i < 50) tracker.recordClick("variant-A");
  }
  // variant-B: 100 clicks / 1000 impressions = 10% CTR
  for (let i = 0; i < 1000; i++) {
    tracker.recordImpression("variant-B");
    if (i < 100) tracker.recordClick("variant-B");
  }

  // Trigger a fresh auto-pause evaluation
  tracker.recordImpression("variant-B");

  const metricsA = tracker.getMetrics("variant-A");
  const metricsB = tracker.getMetrics("variant-B");
  assert.ok(metricsA?.paused, "variant-A (lower CTR) should be paused");
  assert.ok(!metricsB?.paused, "variant-B (higher CTR) should not be paused");
});

test("AbTestTracker: throws when more than maxVariants are registered", () => {
  const tracker = new AbTestTracker(2);
  tracker.register("v1");
  tracker.register("v2");
  assert.throws(() => tracker.register("v3"), /Cannot register more than 2/);
});

test("AbTestTracker: paused variant does not record impressions", () => {
  const tracker = new AbTestTracker();
  tracker.register("vX");
  tracker.pauseVariant("vX", "manual pause");
  tracker.recordImpression("vX");
  assert.equal(tracker.getMetrics("vX")?.impressions, 0);
});

test("AbTestTracker: CTR computed correctly", () => {
  const tracker = new AbTestTracker();
  tracker.register("v1");
  for (let i = 0; i < 10; i++) tracker.recordImpression("v1");
  for (let i = 0; i < 2; i++) tracker.recordClick("v1");
  const m = tracker.getMetrics("v1");
  assert.ok(Math.abs((m?.ctr ?? 0) - 0.2) < 0.001);
});

test("AbTestTracker: getActiveVariants excludes paused variants", () => {
  const tracker = new AbTestTracker();
  tracker.register("va");
  tracker.register("vb");
  tracker.pauseVariant("va", "test");
  const active = tracker.getActiveVariants();
  assert.equal(active.length, 1);
  assert.equal(active[0]?.variantId, "vb");
});

// ─── SmartAdRenderer unit tests ──────────────────────────────────────────────

test("SmartAdRenderer: render returns well-formed HTML with transparency button", () => {
  const eng = new AdaptiveCreativeEngine();
  const comp = new CreativeComposer();
  const ren = new SmartAdRenderer();

  const result = eng.selectVariant({ campaignId: "cmp-renderer-test", attentionScore: 0.5, emotionalState: "neutral", context: "test", deviceType: "desktop", localHour: 12 });
  const composed = comp.compose(result.variant, "native");
  const rendered = ren.render(composed, result.variant);

  assert.ok(rendered.html.includes("qad-ad-container"));
  assert.ok(rendered.html.includes("qad-why-btn"));
  assert.ok(rendered.html.includes("Why this ad?"));
  assert.ok(rendered.styles.length > 0);
  assert.ok(rendered.scripts.length > 0);
  assert.ok(rendered.containerId.startsWith("qad-"));
});

test("SmartAdRenderer: render without transparency button omits why-btn", () => {
  const eng = new AdaptiveCreativeEngine();
  const comp = new CreativeComposer();
  const ren = new SmartAdRenderer();

  const result = eng.selectVariant({ campaignId: "cmp-no-why", attentionScore: 0.5, emotionalState: "neutral", context: "test", deviceType: "desktop", localHour: 12 });
  const composed = comp.compose(result.variant, "native");
  const rendered = ren.render(composed, result.variant, { showTransparencyButton: false });

  assert.ok(!rendered.html.includes("qad-why-btn"));
});

test("SmartAdRenderer: renderPage wraps in full HTML document", () => {
  const eng = new AdaptiveCreativeEngine();
  const comp = new CreativeComposer();
  const ren = new SmartAdRenderer();

  const result = eng.selectVariant({ campaignId: "cmp-page-test", attentionScore: 0.7, emotionalState: "happy", context: "test", deviceType: "tablet", localHour: 11 });
  const composed = comp.compose(result.variant, "banner-leaderboard");
  const rendered = ren.render(composed, result.variant);
  const page = ren.renderPage(rendered, "Test Page");

  assert.ok(page.startsWith("<!DOCTYPE html>"));
  assert.ok(page.includes("Test Page"));
  assert.ok(page.includes("qad-ad-container"));
});

test("SmartAdRenderer: advertiser preview bundle has three attention levels", () => {
  const eng = new AdaptiveCreativeEngine();
  const comp = new CreativeComposer();
  const ren = new SmartAdRenderer();

  const base = { campaignId: "cmp-bundle", emotionalState: "neutral" as const, context: "preview", deviceType: "desktop" as const, localHour: 10 };
  const previewResults = eng.previewAllLevels(base);

  const levels = {
    low: { result: previewResults.low, composed: comp.compose(previewResults.low.variant, "native") },
    medium: { result: previewResults.medium, composed: comp.compose(previewResults.medium.variant, "native") },
    high: { result: previewResults.high, composed: comp.compose(previewResults.high.variant, "native") }
  };

  const bundle = ren.renderAdvertiserPreview(levels, "native");
  assert.ok(bundle.previewHtml.includes("Low Attention"));
  assert.ok(bundle.previewHtml.includes("Medium Attention"));
  assert.ok(bundle.previewHtml.includes("High Attention"));
  assert.ok(bundle.levels.low);
  assert.ok(bundle.levels.medium);
  assert.ok(bundle.levels.high);
});

test("SmartAdRenderer: renders interstitial format without error", () => {
  const eng = new AdaptiveCreativeEngine();
  const comp = new CreativeComposer();
  const ren = new SmartAdRenderer();

  const result = eng.selectVariant({ campaignId: "cmp-interstitial-render", attentionScore: 0.2, emotionalState: "bored", context: "break", deviceType: "mobile", localHour: 20 });
  const composed = comp.compose(result.variant, "interstitial");
  const rendered = ren.render(composed, result.variant);

  assert.ok(rendered.html.includes("qad-interstitial"));
});

// ─── HTTP integration tests ──────────────────────────────────────────────────

test("POST /api/v1/smart-ads/render returns composed creative", async () => {
  const server = app.listen(0);
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected numeric port");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/smart-ads/render`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${makeToken()}`
      },
      body: JSON.stringify({
        campaignId: "cmp-integration-001",
        attentionScore: 0.4,
        emotionalState: "neutral",
        context: "watching a video",
        deviceType: "mobile",
        localHour: 14,
        format: "native"
      })
    });

    assert.equal(response.status, 200);
    const body = await response.json() as {
      campaignId: string;
      variantId: string;
      format: string;
      htmlPayload: string;
      creative: { headline: string; ctaText: string };
      emotionEstimate: { state: string; attentionScore: number };
      transparencyRationale: string[];
    };

    assert.equal(body.campaignId, "cmp-integration-001");
    assert.ok(body.variantId.length > 0);
    assert.equal(body.format, "native");
    assert.ok(body.htmlPayload.length > 0);
    assert.ok(body.creative.headline.length > 0);
    assert.ok(body.creative.ctaText.length > 0);
    assert.ok(body.transparencyRationale.length > 0);
    assert.ok(["happy", "neutral", "bored", "frustrated"].includes(body.emotionEstimate.state));
  } finally {
    server.close();
  }
});

test("POST /api/v1/smart-ads/render returns 401 without JWT", async () => {
  const server = app.listen(0);
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected numeric port");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/smart-ads/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ campaignId: "x", attentionScore: 0.5, emotionalState: "neutral", context: "c", deviceType: "mobile", localHour: 12, format: "native" })
    });
    assert.equal(response.status, 401);
  } finally {
    server.close();
  }
});

test("POST /api/v1/smart-ads/render returns 422 on invalid format", async () => {
  const server = app.listen(0);
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected numeric port");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/smart-ads/render`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${makeToken()}`
      },
      body: JSON.stringify({
        campaignId: "cmp-bad",
        attentionScore: 1.5,
        emotionalState: "neutral",
        context: "test",
        deviceType: "mobile",
        localHour: 12,
        format: "unknown-format"
      })
    });
    assert.equal(response.status, 422);
    const body = await response.json() as { error: string };
    assert.equal(body.error, "Validation failed");
  } finally {
    server.close();
  }
});

test("POST /api/v1/smart-ads/emotion returns emotion estimate", async () => {
  const server = app.listen(0);
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected numeric port");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/smart-ads/emotion`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scrollDeltaPx: 5000,
        elapsedMs: 1000,
        clickCount: 3,
        clickJitterMs: 100,
        dwellTimeSeconds: 1.5,
        idleSeconds: 0.5
      })
    });
    assert.equal(response.status, 200);
    const body = await response.json() as {
      state: string;
      attentionScore: number;
      confidence: number;
      features: { sampleCount: number };
    };
    assert.ok(["happy", "neutral", "bored", "frustrated"].includes(body.state));
    assert.ok(body.attentionScore >= 0 && body.attentionScore <= 1);
    assert.ok(body.confidence >= 0 && body.confidence <= 1);
    assert.ok(body.features.sampleCount >= 1);
  } finally {
    server.close();
  }
});

test("POST /api/v1/smart-ads/emotion returns 422 on invalid input", async () => {
  const server = app.listen(0);
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected numeric port");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/smart-ads/emotion`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scrollDeltaPx: "not-a-number" })
    });
    assert.equal(response.status, 422);
  } finally {
    server.close();
  }
});

test("GET /api/v1/smart-ads/preview returns HTML page with JWT", async () => {
  const server = app.listen(0);
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected numeric port");
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/smart-ads/preview?campaignId=cmp-preview-test&format=native&deviceType=desktop&emotionalState=happy&localHour=14`,
      { headers: { authorization: `Bearer ${makeToken()}` } }
    );
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes("Low Attention"));
    assert.ok(html.includes("High Attention"));
    assert.ok(html.includes("Smart Ad Creative Preview"));
  } finally {
    server.close();
  }
});

test("GET /api/v1/smart-ads/preview returns 401 without JWT", async () => {
  const server = app.listen(0);
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected numeric port");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/smart-ads/preview`);
    assert.equal(response.status, 401);
  } finally {
    server.close();
  }
});

test("POST /api/v1/smart-ads/ab/impression records impression", async () => {
  const server = app.listen(0);
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected numeric port");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/smart-ads/ab/impression`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ placementId: "placement-abc", variantId: "variant-xyz" })
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { ok: boolean };
    assert.equal(body.ok, true);
  } finally {
    server.close();
  }
});

test("POST /api/v1/smart-ads/ab/click records click", async () => {
  const server = app.listen(0);
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected numeric port");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/smart-ads/ab/click`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ placementId: "placement-abc", variantId: "variant-xyz" })
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { ok: boolean };
    assert.equal(body.ok, true);
  } finally {
    server.close();
  }
});

test("GET /api/v1/smart-ads/ab/metrics returns metrics with JWT", async () => {
  const server = app.listen(0);
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected numeric port");

    await fetch(`http://127.0.0.1:${address.port}/api/v1/smart-ads/ab/impression`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ placementId: "placement-metrics-test", variantId: "v1" })
    });

    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/smart-ads/ab/metrics?placementId=placement-metrics-test`,
      { headers: { authorization: `Bearer ${makeToken()}` } }
    );
    assert.equal(response.status, 200);
    const body = await response.json() as {
      placementId: string;
      metrics: Array<{ variantId: string; impressions: number; ctr: number; paused: boolean }>;
    };
    assert.equal(body.placementId, "placement-metrics-test");
    assert.ok(Array.isArray(body.metrics));
    assert.ok(body.metrics.length > 0);
    assert.equal(body.metrics[0]?.variantId, "v1");
  } finally {
    server.close();
  }
});

test("GET /api/v1/smart-ads/ab/metrics returns 422 without placementId", async () => {
  const server = app.listen(0);
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected numeric port");
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/smart-ads/ab/metrics`,
      { headers: { authorization: `Bearer ${makeToken()}` } }
    );
    assert.equal(response.status, 422);
  } finally {
    server.close();
  }
});

test("Smart Ads: interstitial format via HTTP has correct dimensions", async () => {
  const server = app.listen(0);
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected numeric port");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/smart-ads/render`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${makeToken()}` },
      body: JSON.stringify({ campaignId: "cmp-interstitial", attentionScore: 0.2, emotionalState: "bored", context: "between videos", deviceType: "mobile", localHour: 20, format: "interstitial" })
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { format: string; dimensions: { width: number; height: number } };
    assert.equal(body.format, "interstitial");
    assert.equal(body.dimensions.width, 375);
    assert.equal(body.dimensions.height, 667);
  } finally {
    server.close();
  }
});

test("Smart Ads: video-preroll format via HTTP has correct dimensions", async () => {
  const server = app.listen(0);
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected numeric port");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/smart-ads/render`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${makeToken()}` },
      body: JSON.stringify({ campaignId: "cmp-preroll", attentionScore: 0.8, emotionalState: "happy", context: "pre-roll on video", deviceType: "desktop", localHour: 19, format: "video-preroll" })
    });
    assert.equal(response.status, 200);
    const body = await response.json() as { format: string; dimensions: { width: number; height: number } };
    assert.equal(body.format, "video-preroll");
    assert.equal(body.dimensions.width, 1280);
    assert.equal(body.dimensions.height, 720);
  } finally {
    server.close();
  }
});

after(() => {
  app.close();
});
