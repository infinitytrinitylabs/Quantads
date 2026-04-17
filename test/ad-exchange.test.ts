/**
 * ad-exchange.test.ts
 *
 * 25+ tests covering:
 *  – BidProcessor (heap, second-price auction, attention multiplier, budget enforcement)
 *  – IsolationForest / FraudDetector (scoring, thresholds, alerts)
 *  – BotHeuristics (each heuristic, composite score)
 *  – TrackingService (impression buffering, click validation, dedup)
 *  – Campaign CRUD API (full lifecycle via HTTP)
 */

import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { sign } from "jsonwebtoken";
import { app } from "../src/server";
import { BidProcessor } from "../src/engine/BidProcessor";
import { FraudDetector, IsolationForest } from "../src/ml/FraudDetector";
import { BotHeuristics } from "../src/ml/BotHeuristics";
import { trackingService } from "../src/services/TrackingService";
import { FraudFeatures } from "../src/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env["QUANTMAIL_JWT_SECRET"] ?? "dev-secret-change-in-production";

function makeToken(sub = "advertiser-test-001", expiresIn = 3600): string {
  return sign({ sub, iss: "quantmail" }, JWT_SECRET, { algorithm: "HS256", expiresIn });
}

// ─────────────────────────────────────────────────────────────────────────────
// Part 1 – BidProcessor
// ─────────────────────────────────────────────────────────────────────────────

test("BidProcessor: attention multiplier scales CPC correctly", () => {
  const processor = new BidProcessor();

  // attentionScore = 0 → finalCpc = baseCpc × 1
  const r0 = processor.submitBid({
    campaignId: "camp-attn-0",
    targetUserId: "u1",
    baseCpc: 1.00,
    creativeId: "cr1",
    advertiserBudget: 100,
    attentionScore: 0
  });
  assert.equal(r0.finalCpc, 1.00);

  // attentionScore = 1 → finalCpc = baseCpc × 5
  const r1 = processor.submitBid({
    campaignId: "camp-attn-1",
    targetUserId: "u1",
    baseCpc: 1.00,
    creativeId: "cr1",
    advertiserBudget: 100,
    attentionScore: 1
  });
  assert.equal(r1.finalCpc, 5.00);

  // attentionScore = 0.5 → finalCpc = baseCpc × 3
  const r5 = processor.submitBid({
    campaignId: "camp-attn-5",
    targetUserId: "u1",
    baseCpc: 2.00,
    creativeId: "cr1",
    advertiserBudget: 100,
    attentionScore: 0.5
  });
  assert.equal(r5.finalCpc, 6.00);
});

test("BidProcessor: second-price auction – winner pays one cent above second bid", () => {
  const processor = new BidProcessor();
  const campaignId = "camp-vickrey";

  // Submit three bids
  processor.submitBid({ campaignId, targetUserId: "u1", baseCpc: 3.00, creativeId: "cr-high", advertiserBudget: 1000, attentionScore: 0 });
  processor.submitBid({ campaignId, targetUserId: "u2", baseCpc: 2.00, creativeId: "cr-mid",  advertiserBudget: 1000, attentionScore: 0 });
  processor.submitBid({ campaignId, targetUserId: "u3", baseCpc: 1.00, creativeId: "cr-low",  advertiserBudget: 1000, attentionScore: 0 });

  const slot = processor.flushCampaign(campaignId);
  assert.ok(slot, "slot should exist");
  assert.ok(slot!.winner, "there should be a winner");
  assert.equal(slot!.winner!.finalCpc, 3.00);       // highest bidder wins
  assert.equal(slot!.clearingPrice, 2.01);           // second-price + $0.01
});

test("BidProcessor: single bid wins at minimum clearing price ($0.01)", () => {
  const processor = new BidProcessor();
  const campaignId = "camp-solo";

  processor.submitBid({ campaignId, targetUserId: "u1", baseCpc: 5.00, creativeId: "cr1", advertiserBudget: 500, attentionScore: 0 });
  const slot = processor.flushCampaign(campaignId);

  assert.ok(slot!.winner);
  assert.equal(slot!.clearingPrice, 0.01);  // no runner-up → 0 + 0.01
});

test("BidProcessor: campaign is paused after budget exhaustion", () => {
  const processor = new BidProcessor();
  const campaignId = "camp-budget";

  // Budget of $0.10 – a single flush with two bids ($1.00 and $0.50) yields
  // a clearing price of $0.51, which exceeds the $0.10 budget.
  processor.submitBid({ campaignId, targetUserId: "u1", baseCpc: 1.00, creativeId: "cr1", advertiserBudget: 0.10, attentionScore: 0 });
  processor.submitBid({ campaignId, targetUserId: "u2", baseCpc: 0.50, creativeId: "cr1", advertiserBudget: 0.10, attentionScore: 0 });

  processor.flushCampaign(campaignId);

  // After exhaustion, new bids are rejected
  const rejected = processor.submitBid({
    campaignId,
    targetUserId: "u-extra",
    baseCpc: 1.00,
    creativeId: "cr1",
    advertiserBudget: 0.10,
    attentionScore: 0
  });
  assert.equal(rejected.budgetExhausted, true);
  assert.equal(processor.isCampaignExhausted(campaignId), true);
});

test("BidProcessor: heap orders bids correctly (max-heap invariant)", () => {
  const processor = new BidProcessor();
  const campaignId = "camp-heap";
  const cpcs = [1.50, 3.00, 0.75, 2.25, 5.00, 1.00];

  for (const cpc of cpcs) {
    processor.submitBid({ campaignId, targetUserId: "u1", baseCpc: cpc, creativeId: "cr1", advertiserBudget: 9999, attentionScore: 0 });
  }

  const slot = processor.flushCampaign(campaignId);
  assert.ok(slot!.winner);
  assert.equal(slot!.winner!.finalCpc, 5.00);  // highest wins
});

test("BidProcessor: getTotalSpend accumulates across multiple flushes", () => {
  const processor = new BidProcessor();
  const campaignId = "camp-spend";

  // Two flushes of a single bid each (clearing price = 0.01 per flush)
  processor.submitBid({ campaignId, targetUserId: "u1", baseCpc: 1.00, creativeId: "cr1", advertiserBudget: 500, attentionScore: 0 });
  processor.flushCampaign(campaignId);

  processor.submitBid({ campaignId, targetUserId: "u2", baseCpc: 1.00, creativeId: "cr1", advertiserBudget: 500, attentionScore: 0 });
  processor.flushCampaign(campaignId);

  assert.equal(processor.getTotalSpend(campaignId), 0.02);
});

test("BidProcessor: returns empty slot when no bids pending", () => {
  const processor = new BidProcessor();
  const slot = processor.flushCampaign("camp-empty");
  assert.equal(slot, null);
});

test("BidProcessor: attention score is clamped to [0, 1]", () => {
  const processor = new BidProcessor();

  const rOver = processor.submitBid({ campaignId: "camp-clamp", targetUserId: "u1", baseCpc: 1.00, creativeId: "cr1", advertiserBudget: 100, attentionScore: 2.5 });
  assert.equal(rOver.finalCpc, 5.00);  // clamped to 1 → ×5

  const rUnder = processor.submitBid({ campaignId: "camp-clamp2", targetUserId: "u1", baseCpc: 1.00, creativeId: "cr1", advertiserBudget: 100, attentionScore: -0.5 });
  assert.equal(rUnder.finalCpc, 1.00); // clamped to 0 → ×1
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 2a – IsolationForest
// ─────────────────────────────────────────────────────────────────────────────

const NORMAL_TRAINING: FraudFeatures[] = Array.from({ length: 50 }, (_, i) => ({
  clickRate: 0.02 + (i % 5) * 0.01,
  avgDwellTime: 8000 + i * 100,
  attentionVariance: 0.1 + (i % 3) * 0.02,
  uniqueIpCount: 1 + (i % 2),
  sessionDuration: 120000 + i * 5000
}));

test("IsolationForest: throws when scoring before training", () => {
  const forest = new IsolationForest();
  assert.throws(() => {
    forest.score([0.5, 5000, 0.1, 1, 120000]);
  }, /not been trained/);
});

test("IsolationForest: throws on empty training set", () => {
  const forest = new IsolationForest();
  assert.throws(() => forest.train([]), /empty dataset/);
});

test("IsolationForest: anomaly scores are in (0, 1) range", () => {
  const forest = new IsolationForest(50, 32);
  forest.train(NORMAL_TRAINING.map((f) => [f.clickRate, f.avgDwellTime / 1000, f.attentionVariance, f.uniqueIpCount, f.sessionDuration / 1000]));

  const normalScore = forest.score([0.04, 9, 0.14, 1, 160]);
  assert.ok(normalScore > 0 && normalScore < 1, `Expected (0,1) but got ${normalScore}`);

  const anomalyScore = forest.score([0.99, 0.1, 0.0, 300, 0.5]);
  assert.ok(anomalyScore > 0 && anomalyScore < 1, `Expected (0,1) but got ${anomalyScore}`);
});

test("IsolationForest: obvious anomaly scores higher than obvious normal", () => {
  const forest = new IsolationForest(100, 32);
  forest.train(NORMAL_TRAINING.map((f) => [f.clickRate, f.avgDwellTime / 1000, f.attentionVariance, f.uniqueIpCount, f.sessionDuration / 1000]));

  const normalScore = forest.score([0.03, 9.5, 0.13, 1, 200]);
  const anomalyScore = forest.score([0.99, 0.2, 0.0, 500, 0.1]);

  assert.ok(
    anomalyScore > normalScore,
    `Anomaly score (${anomalyScore}) should exceed normal score (${normalScore})`
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 2b – FraudDetector
// ─────────────────────────────────────────────────────────────────────────────

test("FraudDetector: clean user gets 'clean' verdict", () => {
  const detector = new FraudDetector();
  detector.trainOnHistoricalData(NORMAL_TRAINING);

  const alert = detector.evaluate("user-clean", {
    clickRate: 0.04,
    avgDwellTime: 9000,
    attentionVariance: 0.13,
    uniqueIpCount: 1,
    sessionDuration: 200000
  });

  assert.equal(alert.verdict, "clean");
  assert.equal(alert.autoRefunded, false);
});

test("FraudDetector: obvious bot triggers block verdict", () => {
  const detector = new FraudDetector();
  detector.trainOnHistoricalData(NORMAL_TRAINING);

  // Force block via heuristic flags (≥3 flags → blocked regardless of ML score)
  const alert = detector.evaluate(
    "user-bot",
    { clickRate: 0.04, avgDwellTime: 9000, attentionVariance: 0.1, uniqueIpCount: 1, sessionDuration: 150000 },
    ["ROBOTIC_DWELL", "NO_MOUSE", "HEADLESS"]
  );

  assert.equal(alert.verdict, "blocked");
  assert.equal(alert.autoRefunded, true);
});

test("FraudDetector: single heuristic flag upgrades verdict to suspicious", () => {
  const detector = new FraudDetector();
  detector.trainOnHistoricalData(NORMAL_TRAINING);

  const alert = detector.evaluate(
    "user-sus",
    { clickRate: 0.04, avgDwellTime: 9000, attentionVariance: 0.1, uniqueIpCount: 1, sessionDuration: 150000 },
    ["NO_MOUSE"]
  );

  // One flag → at least suspicious
  assert.ok(alert.verdict === "suspicious" || alert.verdict === "blocked");
});

test("FraudDetector: getAlertsForUser returns correct user alerts", () => {
  const detector = new FraudDetector();
  detector.trainOnHistoricalData(NORMAL_TRAINING);

  detector.evaluate("user-a", { clickRate: 0.03, avgDwellTime: 8500, attentionVariance: 0.12, uniqueIpCount: 1, sessionDuration: 180000 });
  detector.evaluate("user-b", { clickRate: 0.04, avgDwellTime: 9000, attentionVariance: 0.13, uniqueIpCount: 1, sessionDuration: 200000 });
  detector.evaluate("user-a", { clickRate: 0.05, avgDwellTime: 8000, attentionVariance: 0.11, uniqueIpCount: 1, sessionDuration: 160000 });

  assert.equal(detector.getAlertsForUser("user-a").length, 2);
  assert.equal(detector.getAlertsForUser("user-b").length, 1);
  assert.equal(detector.getAlertsForUser("user-c").length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 3 – BotHeuristics
// ─────────────────────────────────────────────────────────────────────────────

test("BotHeuristics: clean user produces no flags", () => {
  const heuristics = new BotHeuristics();
  const result = heuristics.analyse({
    userId: "user-human",
    dwellTimeSamples: [8500, 9200, 7800, 11000, 8900, 9500],
    mouseMovementSamples: [45, 120, 88, 200, 55],
    locations: [
      { latitude: 40.7128, longitude: -74.0060, timestampMs: 1000 },
      { latitude: 40.7580, longitude: -73.9855, timestampMs: 600000 }  // ~5 km / 10 min = plausible
    ],
    browserFingerprint: { hasWebGL: true, hasAudioContext: true, userAgent: "Mozilla/5.0 Chrome/120" }
  });

  assert.equal(result.flags.length, 0);
  assert.ok(result.compositeScore < 0.3, `Expected low composite score, got ${result.compositeScore}`);
});

test("BotHeuristics: identical dwell times trigger ROBOTIC_DWELL flag", () => {
  const heuristics = new BotHeuristics();
  const result = heuristics.analyse({
    userId: "user-robot",
    dwellTimeSamples: [5000, 5000, 5000, 5001, 5000, 5000, 5000, 5000],
    mouseMovementSamples: [10, 20, 30],
    locations: [],
    browserFingerprint: { hasWebGL: true, hasAudioContext: true, userAgent: "Chrome/120" }
  });

  assert.ok(result.flags.includes("ROBOTIC_DWELL"), `Expected ROBOTIC_DWELL flag, got: ${JSON.stringify(result.flags)}`);
});

test("BotHeuristics: zero mouse movement triggers NO_MOUSE flag", () => {
  const heuristics = new BotHeuristics();
  const result = heuristics.analyse({
    userId: "user-static",
    dwellTimeSamples: [8000, 9000, 10000, 8500, 9500, 11000],
    mouseMovementSamples: [],
    locations: [],
    browserFingerprint: { hasWebGL: true, hasAudioContext: true, userAgent: "Chrome/120" }
  });

  assert.ok(result.flags.includes("NO_MOUSE"), `Expected NO_MOUSE flag, got: ${JSON.stringify(result.flags)}`);
});

test("BotHeuristics: impossible geographic jump triggers GEO_JUMP flag", () => {
  const heuristics = new BotHeuristics();
  const nyc   = { latitude: 40.7128, longitude: -74.0060, timestampMs: 0 };
  const tokyo = { latitude: 35.6762, longitude: 139.6503, timestampMs: 300_000 }; // 5 min later

  const result = heuristics.analyse({
    userId: "user-teleport",
    dwellTimeSamples: [8000, 9000],
    mouseMovementSamples: [50, 100],
    locations: [nyc, tokyo],
    browserFingerprint: { hasWebGL: true, hasAudioContext: true, userAgent: "Chrome/120" }
  });

  assert.ok(result.flags.includes("GEO_JUMP"), `Expected GEO_JUMP flag, got: ${JSON.stringify(result.flags)}`);
});

test("BotHeuristics: headless browser UA triggers HEADLESS flag", () => {
  const heuristics = new BotHeuristics();
  const result = heuristics.analyse({
    userId: "user-headless",
    dwellTimeSamples: [8000, 9000, 10000, 8500, 9500, 11000],
    mouseMovementSamples: [50, 100],
    locations: [],
    browserFingerprint: {
      hasWebGL: false,
      hasAudioContext: false,
      userAgent: "HeadlessChrome/120"
    }
  });

  assert.ok(result.flags.includes("HEADLESS"), `Expected HEADLESS flag, got: ${JSON.stringify(result.flags)}`);
});

test("BotHeuristics: composite score is bounded [0, 1]", () => {
  const heuristics = new BotHeuristics();
  const result = heuristics.analyse({
    userId: "user-worst",
    dwellTimeSamples: [500, 500, 500, 500, 500, 500, 500, 500],
    mouseMovementSamples: [],
    locations: [
      { latitude: 40.7128, longitude: -74.0060, timestampMs: 0 },
      { latitude: 35.6762, longitude: 139.6503, timestampMs: 60_000 }
    ],
    browserFingerprint: { hasWebGL: false, hasAudioContext: false, userAgent: "HeadlessChrome" }
  });

  assert.ok(result.compositeScore >= 0 && result.compositeScore <= 1,
    `Composite score out of bounds: ${result.compositeScore}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 4 – TrackingService
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  trackingService.reset();
});

test("TrackingService: recordImpression creates impression in buffer", () => {
  const imp = trackingService.recordImpression("ad-001", "user-001", 0.75, 8500);
  assert.ok(imp.id);
  assert.equal(imp.adId, "ad-001");
  assert.equal(imp.userId, "user-001");
  assert.equal(imp.attentionScore, 0.75);
  assert.equal(imp.dwellTimeMs, 8500);
});

test("TrackingService: click within 30s of impression is valid", () => {
  trackingService.recordImpression("ad-002", "user-002", 0.6, 5000);
  const click = trackingService.recordClick("ad-002", "user-002");
  assert.equal(click.valid, true);
  assert.equal(click.adId, "ad-002");
});

test("TrackingService: click without impression is invalid", () => {
  const click = trackingService.recordClick("ad-no-imp", "user-orphan");
  assert.equal(click.valid, false);
});

test("TrackingService: duplicate click within 60s dedup window is invalid", () => {
  trackingService.recordImpression("ad-003", "user-003", 0.5, 4000);
  const first = trackingService.recordClick("ad-003", "user-003");
  assert.equal(first.valid, true);

  // Re-record impression so there IS a matching impression for the second click,
  // but the dedup window should reject it
  trackingService.recordImpression("ad-003", "user-003", 0.5, 4000);
  const second = trackingService.recordClick("ad-003", "user-003");
  assert.equal(second.valid, false);
});

test("TrackingService: getImpressionsForAd returns all matching records after flush", () => {
  trackingService.recordImpression("ad-004", "user-004", 0.8, 6000);
  trackingService.recordImpression("ad-004", "user-005", 0.7, 7000);
  trackingService.recordImpression("ad-999", "user-004", 0.9, 5000);

  trackingService.flush();

  const results = trackingService.getImpressionsForAd("ad-004");
  assert.equal(results.length, 2);
  assert.ok(results.every((i) => i.adId === "ad-004"));
});

test("TrackingService: attentionScore is clamped to [0, 1]", () => {
  const imp = trackingService.recordImpression("ad-005", "user-006", 1.5, 5000);
  assert.equal(imp.attentionScore, 1);

  const imp2 = trackingService.recordImpression("ad-006", "user-007", -0.2, 5000);
  assert.equal(imp2.attentionScore, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Part 5 – Campaign CRUD API (integration tests via HTTP)
// ─────────────────────────────────────────────────────────────────────────────

test("POST /api/v1/campaigns creates a campaign", async () => {
  const server = app.listen(0);
  await once(server, "listening");
  try {
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("Expected numeric port");

    const res = await fetch(`http://127.0.0.1:${addr.port}/api/v1/campaigns`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${makeToken()}` },
      body: JSON.stringify({
        name: "Summer Sale 2026",
        budget: 5000,
        targetingRules: { ageMin: 18, ageMax: 35, interests: ["travel", "fashion"] },
        creatives: [{ url: "https://cdn.example.com/ad.png", format: "banner" }]
      })
    });

    assert.equal(res.status, 201);
    const body = await res.json() as { id: string; name: string; status: string; budget: number };
    assert.equal(body.name, "Summer Sale 2026");
    assert.equal(body.status, "active");
    assert.equal(body.budget, 5000);
    assert.ok(body.id);
  } finally {
    server.close();
  }
});

test("POST /api/v1/campaigns returns 401 without token", async () => {
  const server = app.listen(0);
  await once(server, "listening");
  try {
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("Expected numeric port");

    const res = await fetch(`http://127.0.0.1:${addr.port}/api/v1/campaigns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Test", budget: 100 })
    });
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test("POST /api/v1/campaigns returns 422 on invalid input", async () => {
  const server = app.listen(0);
  await once(server, "listening");
  try {
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("Expected numeric port");

    const res = await fetch(`http://127.0.0.1:${addr.port}/api/v1/campaigns`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${makeToken()}` },
      body: JSON.stringify({ name: "", budget: -100 })
    });
    assert.equal(res.status, 422);
    const body = await res.json() as { error: string };
    assert.equal(body.error, "Validation failed");
  } finally {
    server.close();
  }
});

test("GET /api/v1/campaigns returns campaign list", async () => {
  const server = app.listen(0);
  await once(server, "listening");
  try {
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("Expected numeric port");
    const token = makeToken("lister-user");
    const base = `http://127.0.0.1:${addr.port}`;
    const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };

    // Create two campaigns
    await fetch(`${base}/api/v1/campaigns`, { method: "POST", headers, body: JSON.stringify({ name: "Camp A", budget: 1000 }) });
    await fetch(`${base}/api/v1/campaigns`, { method: "POST", headers, body: JSON.stringify({ name: "Camp B", budget: 2000 }) });

    const res = await fetch(`${base}/api/v1/campaigns`, { method: "GET", headers: { authorization: `Bearer ${token}` } });
    assert.equal(res.status, 200);
    const body = await res.json() as { campaigns: unknown[]; total: number };
    assert.ok(body.total >= 2);
    assert.ok(body.campaigns.length >= 2);
  } finally {
    server.close();
  }
});

test("PATCH /api/v1/campaigns/:id updates campaign status", async () => {
  const server = app.listen(0);
  await once(server, "listening");
  try {
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("Expected numeric port");
    const token = makeToken("patch-user");
    const base = `http://127.0.0.1:${addr.port}`;
    const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };

    const createRes = await fetch(`${base}/api/v1/campaigns`, {
      method: "POST", headers, body: JSON.stringify({ name: "Pauseable", budget: 500 })
    });
    const created = await createRes.json() as { id: string };

    const patchRes = await fetch(`${base}/api/v1/campaigns/${created.id}`, {
      method: "PATCH", headers, body: JSON.stringify({ status: "paused" })
    });
    assert.equal(patchRes.status, 200);
    const patched = await patchRes.json() as { status: string };
    assert.equal(patched.status, "paused");
  } finally {
    server.close();
  }
});

test("DELETE /api/v1/campaigns/:id soft-deletes a campaign", async () => {
  const server = app.listen(0);
  await once(server, "listening");
  try {
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("Expected numeric port");
    const token = makeToken("delete-user");
    const base = `http://127.0.0.1:${addr.port}`;
    const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };

    const createRes = await fetch(`${base}/api/v1/campaigns`, {
      method: "POST", headers, body: JSON.stringify({ name: "Deleteable", budget: 500 })
    });
    const created = await createRes.json() as { id: string };

    const delRes = await fetch(`${base}/api/v1/campaigns/${created.id}`, {
      method: "DELETE", headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(delRes.status, 200);
    const delBody = await delRes.json() as { deleted: boolean };
    assert.equal(delBody.deleted, true);

    // Campaign should no longer appear in list
    const listRes = await fetch(`${base}/api/v1/campaigns`, { method: "GET", headers: { authorization: `Bearer ${token}` } });
    const list = await listRes.json() as { campaigns: Array<{ id: string }> };
    assert.ok(!list.campaigns.some((c) => c.id === created.id));
  } finally {
    server.close();
  }
});

test("GET /api/v1/campaigns/:id/analytics returns analytics", async () => {
  const server = app.listen(0);
  await once(server, "listening");
  try {
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("Expected numeric port");
    const token = makeToken("analytics-user");
    const base = `http://127.0.0.1:${addr.port}`;
    const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };

    const createRes = await fetch(`${base}/api/v1/campaigns`, {
      method: "POST", headers, body: JSON.stringify({ name: "Analytics Camp", budget: 1000 })
    });
    const created = await createRes.json() as { id: string };

    const analyticsRes = await fetch(`${base}/api/v1/campaigns/${created.id}/analytics`, {
      method: "GET", headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(analyticsRes.status, 200);
    const analytics = await analyticsRes.json() as {
      campaignId: string; impressions: number; clicks: number; ctr: number;
    };
    assert.equal(analytics.campaignId, created.id);
    assert.ok(typeof analytics.impressions === "number");
    assert.ok(typeof analytics.ctr === "number");
  } finally {
    server.close();
  }
});

test("PATCH /api/v1/campaigns/:id returns 404 for non-existent campaign", async () => {
  const server = app.listen(0);
  await once(server, "listening");
  try {
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("Expected numeric port");

    const res = await fetch(`http://127.0.0.1:${addr.port}/api/v1/campaigns/nonexistent-id`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${makeToken()}` },
      body: JSON.stringify({ status: "paused" })
    });
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});

test("DELETE /api/v1/campaigns/:id returns 404 for non-existent campaign", async () => {
  const server = app.listen(0);
  await once(server, "listening");
  try {
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("Expected numeric port");

    const res = await fetch(`http://127.0.0.1:${addr.port}/api/v1/campaigns/no-such-camp`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${makeToken()}` }
    });
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});

test("Campaign advertiser isolation: other user cannot update campaign", async () => {
  const server = app.listen(0);
  await once(server, "listening");
  try {
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("Expected numeric port");
    const base = `http://127.0.0.1:${addr.port}`;

    const ownerToken = makeToken("owner-user");
    const otherToken = makeToken("other-user");

    const createRes = await fetch(`${base}/api/v1/campaigns`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ name: "Private Camp", budget: 500 })
    });
    const created = await createRes.json() as { id: string };

    const patchRes = await fetch(`${base}/api/v1/campaigns/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${otherToken}` },
      body: JSON.stringify({ status: "paused" })
    });
    assert.equal(patchRes.status, 404); // correct – cannot see other advertiser's campaign
  } finally {
    server.close();
  }
});

after(() => {
  app.close();
});
