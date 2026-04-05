import test, { after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { sign } from "jsonwebtoken";
import { app } from "../src/server";

const JWT_SECRET = process.env["QUANTMAIL_JWT_SECRET"] ?? "dev-secret-change-in-production";

function makeToken(sub = "user-test-001", expiresIn = 3600): string {
  return sign({ sub, iss: "quantmail" }, JWT_SECRET, {
    algorithm: "HS256",
    expiresIn
  });
}

test("POST /api/v1/ads/contextual returns native ads for travel context", async () => {
  const server = app.listen(0);
  await once(server, "listening");

  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected numeric port");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/ads/contextual`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${makeToken()}`
      },
      body: JSON.stringify({
        platform: "quanttube",
        activityContext: "watching a travel vlog about adventure and explore",
        moodSignals: { purchaseIntent: 0.7, curiosity: 0.8 },
        maxAds: 3
      })
    });

    assert.equal(response.status, 200);

    const body = await response.json() as {
      platform: string;
      ads: Array<{ campaignId: string; piiUsed: boolean; relevanceScore: number }>;
      meta: { piiUsed: boolean; engine: string };
    };

    assert.equal(body.platform, "quanttube");
    assert.ok(Array.isArray(body.ads));
    assert.ok(body.ads.length > 0);
    assert.equal(body.meta.piiUsed, false);
    assert.match(body.meta.engine, /quantads-contextual/);

    // All ads must confirm no PII was used
    for (const ad of body.ads) {
      assert.equal(ad.piiUsed, false);
      assert.ok(ad.relevanceScore >= 0);
    }
  } finally {
    server.close();
  }
});

test("POST /api/v1/ads/contextual returns 401 without a valid JWT", async () => {
  const server = app.listen(0);
  await once(server, "listening");

  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected numeric port");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/ads/contextual`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform: "quanttube", activityContext: "travel vlog" })
    });

    assert.equal(response.status, 401);
  } finally {
    server.close();
  }
});

test("POST /api/v1/ads/contextual returns 422 on invalid input", async () => {
  const server = app.listen(0);
  await once(server, "listening");

  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected numeric port");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/ads/contextual`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${makeToken()}`
      },
      body: JSON.stringify({
        platform: "unknown-platform",   // invalid enum
        activityContext: ""             // too short
      })
    });

    assert.equal(response.status, 422);

    const body = await response.json() as { error: string; details: string[] };
    assert.equal(body.error, "Validation failed");
    assert.ok(Array.isArray(body.details));
  } finally {
    server.close();
  }
});

test("GET /api/v1/analytics/campaigns returns performance metrics with JWT", async () => {
  const server = app.listen(0);
  await once(server, "listening");

  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected numeric port");

    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/analytics/campaigns?campaignId=cmp-travel-gear-001`,
      {
        method: "GET",
        headers: { authorization: `Bearer ${makeToken()}` }
      }
    );

    assert.equal(response.status, 200);

    const body = await response.json() as {
      campaignId: string;
      summary: {
        impressions: number;
        clicks: number;
        ctr: number;
        roas: number;
      };
    };

    assert.equal(body.campaignId, "cmp-travel-gear-001");
    assert.ok(body.summary.impressions > 0);
    assert.ok(body.summary.ctr >= 0);
    assert.ok(body.summary.roas >= 0);
  } finally {
    server.close();
  }
});

test("GET /api/v1/analytics/roi returns overall ROI with JWT", async () => {
  const server = app.listen(0);
  await once(server, "listening");

  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected numeric port");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/analytics/roi`, {
      method: "GET",
      headers: { authorization: `Bearer ${makeToken()}` }
    });

    assert.equal(response.status, 200);

    const body = await response.json() as {
      overall: { spend: number; revenue: number; roas: number };
      campaigns: Array<{ campaignId: string }>;
    };

    assert.ok(body.overall.spend > 0);
    assert.ok(body.overall.revenue > 0);
    assert.ok(body.overall.roas > 0);
    assert.ok(body.campaigns.length > 0);
  } finally {
    server.close();
  }
});

test("GET /api/v1/analytics/campaigns returns 401 without JWT", async () => {
  const server = app.listen(0);
  await once(server, "listening");

  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected numeric port");

    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/analytics/campaigns`,
      { method: "GET" }
    );

    assert.equal(response.status, 401);
  } finally {
    server.close();
  }
});

after(() => {
  app.close();
});
