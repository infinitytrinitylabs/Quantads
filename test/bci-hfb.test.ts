/**
 * Tests for:
 *  1. BCI AttentionStore – sample ingestion, windowing, aggregation
 *  2. FraudDetector     – bot signal detection heuristics
 *  3. BiddingEngine     – attention-score multiplier integration
 *  4. HFBExchange       – ring-buffer submit/drain, Vickrey clearing
 *  5. BCI + Exchange API routes (via HTTP)
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { sign } from "jsonwebtoken";
import { AttentionStore, BiometricSample } from "../src/bci/AttentionStore";
import { detectFraud } from "../src/bci/FraudDetector";
import { BiddingEngine } from "../src/bidding/BiddingEngine";
import { HFBExchange, attentionCpcMultiplier } from "../src/exchange/HFBExchange";
import { app } from "../src/server";

const JWT_SECRET = process.env["QUANTMAIL_JWT_SECRET"] ?? "dev-secret-change-in-production";

function makeToken(sub = "test-user-bci", expiresIn = 3600): string {
  return sign({ sub, iss: "quantmail" }, JWT_SECRET, { algorithm: "HS256", expiresIn });
}

function makeSample(overrides: Partial<BiometricSample> = {}): BiometricSample {
  return {
    eyeTrackingScore: 0.75,
    heartRate: 72,
    neuralActivity: 0.65,
    recordedAt: new Date().toISOString(),
    ...overrides
  };
}

// ── AttentionStore ────────────────────────────────────────────────────────────

test("AttentionStore: ingest returns aggregated attention for a single sample", () => {
  const store = new AttentionStore();
  const window = store.ingest("u1", makeSample({ eyeTrackingScore: 1.0, heartRate: 90, neuralActivity: 1.0 }));

  assert.equal(window.userId, "u1");
  assert.equal(window.aggregated.sampleCount, 1);
  assert.ok(window.aggregated.attentionScore > 0);
  assert.ok(window.aggregated.attentionScore <= 1);
});

test("AttentionStore: higher biometric values produce higher attention score", () => {
  const store = new AttentionStore();

  const low = store.ingest("u-low", makeSample({ eyeTrackingScore: 0.1, heartRate: 60, neuralActivity: 0.1 }));
  const high = store.ingest("u-high", makeSample({ eyeTrackingScore: 0.95, heartRate: 88, neuralActivity: 0.9 }));

  assert.ok(high.aggregated.attentionScore > low.aggregated.attentionScore);
});

test("AttentionStore: getAggregated returns null for unknown user", () => {
  const store = new AttentionStore();
  assert.equal(store.getAggregated("nobody"), null);
});

test("AttentionStore: tracks multiple samples and accumulates", () => {
  const store = new AttentionStore();

  for (let i = 0; i < 5; i++) {
    store.ingest("u-multi", makeSample());
  }

  const agg = store.getAggregated("u-multi");
  assert.ok(agg !== null);
  assert.equal(agg.sampleCount, 5);
});

// ── FraudDetector ─────────────────────────────────────────────────────────────

test("FraudDetector: clean samples pass as clean", () => {
  const samples: BiometricSample[] = [
    makeSample({ heartRate: 68, eyeTrackingScore: 0.6, neuralActivity: 0.55 }),
    makeSample({ heartRate: 70, eyeTrackingScore: 0.7, neuralActivity: 0.60 }),
    makeSample({ heartRate: 72, eyeTrackingScore: 0.65, neuralActivity: 0.58 }),
    makeSample({ heartRate: 69, eyeTrackingScore: 0.68, neuralActivity: 0.62 })
  ];

  const result = detectFraud(samples);
  assert.notEqual(result.verdict, "fraud");
  assert.ok(result.fraudScore < 0.5);
});

test("FraudDetector: near-zero heart-rate variance triggers bot flag", () => {
  const samples: BiometricSample[] = Array.from({ length: 6 }, () =>
    makeSample({ heartRate: 72.0000 })
  );

  const result = detectFraud(samples);
  assert.ok(result.flags.some((f) => f.startsWith("low-variance:heartRate")));
  assert.ok(result.fraudScore >= 0.4);
});

test("FraudDetector: out-of-range heart rate is flagged as fraud", () => {
  const samples = [makeSample({ heartRate: 999 })];
  const result = detectFraud(samples);
  assert.equal(result.verdict, "fraud");
  assert.ok(result.flags.some((f) => f.startsWith("out-of-range:heartRate")));
});

test("FraudDetector: impossible HR delta between consecutive samples flags fraud", () => {
  const samples: BiometricSample[] = [
    makeSample({ heartRate: 60 }),
    makeSample({ heartRate: 60 }),
    makeSample({ heartRate: 60 }),
    makeSample({ heartRate: 115 })  // jump to 115 bpm (+55 delta – physiologically impossible between samples)
  ];

  const result = detectFraud(samples);
  assert.ok(result.flags.some((f) => f.startsWith("impossible-hr-delta")));
});

test("FraudDetector: empty samples return clean verdict", () => {
  const result = detectFraud([]);
  assert.equal(result.verdict, "clean");
  assert.equal(result.fraudScore, 0);
});

// ── BiddingEngine attention multiplier ───────────────────────────────────────

test("BiddingEngine: attention score of 1.0 produces higher bid than 0.0", () => {
  const engine = new BiddingEngine();

  const distracted = engine.calculateOutcomeBid({
    baseOutcomePrice: 20,
    audience: { verifiedLtv: 50, intentScore: 0.5, conversionRate: 0.3, attentionScore: 0.0 }
  });

  const attentive = engine.calculateOutcomeBid({
    baseOutcomePrice: 20,
    audience: { verifiedLtv: 50, intentScore: 0.5, conversionRate: 0.3, attentionScore: 1.0 }
  });

  assert.ok(attentive.finalBid > distracted.finalBid);
  assert.ok(attentive.breakdown.attentionMultiplier > distracted.breakdown.attentionMultiplier);
});

test("BiddingEngine: no attentionScore defaults to multiplier 1.0", () => {
  const engine = new BiddingEngine();
  const result = engine.calculateOutcomeBid({
    baseOutcomePrice: 20,
    audience: { verifiedLtv: 50, intentScore: 0.5, conversionRate: 0.3 }
  });

  assert.equal(result.breakdown.attentionMultiplier, 1.0);
});

test("BiddingEngine: attentionMultiplier is clamped to [0.6, 1.8]", () => {
  const engine = new BiddingEngine();

  const min = engine.calculateOutcomeBid({
    baseOutcomePrice: 20,
    audience: { verifiedLtv: 50, intentScore: 0.5, conversionRate: 0.3, attentionScore: 0.0 }
  });

  const max = engine.calculateOutcomeBid({
    baseOutcomePrice: 20,
    audience: { verifiedLtv: 50, intentScore: 0.5, conversionRate: 0.3, attentionScore: 1.0 }
  });

  assert.ok(min.breakdown.attentionMultiplier >= 0.6);
  assert.ok(max.breakdown.attentionMultiplier <= 1.8);
});

// ── HFBExchange ───────────────────────────────────────────────────────────────

test("HFBExchange: submit returns a Redis-style stream ID", () => {
  const exchange = new HFBExchange();
  const streamId = exchange.submit({
    bidId: "b1",
    advertiserId: "adv1",
    adSlotId: "slot1",
    cpcBid: 1.0,
    attentionScore: 0.8,
    submittedAt: new Date().toISOString()
  });

  assert.ok(streamId !== null);
  assert.match(streamId!, /^\d+-\d+$/);
});

test("HFBExchange: drain performs Vickrey second-price auction per slot", () => {
  const exchange = new HFBExchange();
  const ts = new Date().toISOString();

  exchange.submit({ bidId: "b1", advertiserId: "adv1", adSlotId: "slot-A", cpcBid: 2.0, attentionScore: 0.8, submittedAt: ts });
  exchange.submit({ bidId: "b2", advertiserId: "adv2", adSlotId: "slot-A", cpcBid: 1.0, attentionScore: 0.5, submittedAt: ts });

  const cleared = exchange.drain(10);
  const winner = cleared.find((c) => c.won);
  const loser = cleared.find((c) => !c.won);

  assert.ok(winner !== undefined);
  assert.ok(loser !== undefined);

  // Winner's effective CPC should be ≥ loser's
  assert.ok(winner!.effectiveCpc >= loser!.effectiveCpc);

  // Vickrey: winner pays loser's effective price
  assert.ok(winner!.clearingPrice <= winner!.effectiveCpc);

  // Loser clearing price is 0
  assert.equal(loser!.clearingPrice, 0);
});

test("HFBExchange: attention multiplier scales CPC correctly", () => {
  assert.ok(attentionCpcMultiplier(0) >= 0.6);
  assert.ok(attentionCpcMultiplier(1) <= 1.8);
  assert.ok(attentionCpcMultiplier(0.5) > attentionCpcMultiplier(0));
  assert.ok(attentionCpcMultiplier(1) > attentionCpcMultiplier(0.5));
});

test("HFBExchange: returns null when buffer is full", () => {
  const exchange = new HFBExchange(2);
  const ts = new Date().toISOString();

  exchange.submit({ bidId: "b1", advertiserId: "a", adSlotId: "s", cpcBid: 1, attentionScore: 0.5, submittedAt: ts });
  exchange.submit({ bidId: "b2", advertiserId: "a", adSlotId: "s", cpcBid: 1, attentionScore: 0.5, submittedAt: ts });
  const overflow = exchange.submit({ bidId: "b3", advertiserId: "a", adSlotId: "s", cpcBid: 1, attentionScore: 0.5, submittedAt: ts });

  assert.equal(overflow, null);
  assert.equal(exchange.stats().totalDropped, 1);
});

test("HFBExchange: stats reflect submitted and processed counts", () => {
  const exchange = new HFBExchange();
  const ts = new Date().toISOString();

  exchange.submit({ bidId: "x1", advertiserId: "a", adSlotId: "s1", cpcBid: 1, attentionScore: 0.7, submittedAt: ts });
  exchange.submit({ bidId: "x2", advertiserId: "b", adSlotId: "s1", cpcBid: 0.8, attentionScore: 0.4, submittedAt: ts });
  exchange.drain(10);

  const stats = exchange.stats();
  assert.equal(stats.totalSubmitted, 2);
  assert.equal(stats.totalProcessed, 2);
  assert.equal(stats.activeBids, 0);
});

// ── HTTP API routes ───────────────────────────────────────────────────────────

test("POST /api/v1/bci/attention ingests a sample and returns aggregated score", async () => {
  const server = app.listen(0);
  await once(server, "listening");

  try {
    const address = server.address() as { port: number };
    const token = makeToken("bci-http-user");

    const res = await fetch(`http://127.0.0.1:${address.port}/api/v1/bci/attention`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        sample: {
          eyeTrackingScore: 0.85,
          heartRate: 74,
          neuralActivity: 0.70,
          recordedAt: new Date().toISOString()
        }
      })
    });

    assert.equal(res.status, 200);

    const body = await res.json() as {
      userId: string;
      aggregated: { attentionScore: number; sampleCount: number };
      fraud: { verdict: string };
    };

    assert.equal(body.userId, "bci-http-user");
    assert.ok(body.aggregated.attentionScore > 0);
    assert.equal(body.aggregated.sampleCount, 1);
    assert.notEqual(body.fraud.verdict, "fraud");
  } finally {
    server.close();
  }
});

test("POST /api/v1/bci/attention rejects without auth", async () => {
  const server = app.listen(0);
  await once(server, "listening");

  try {
    const address = server.address() as { port: number };

    const res = await fetch(`http://127.0.0.1:${address.port}/api/v1/bci/attention`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sample: makeSample() })
    });

    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test("POST /api/v1/exchange/bid submits bid and returns stream ID with cleared results", async () => {
  const server = app.listen(0);
  await once(server, "listening");

  try {
    const address = server.address() as { port: number };
    const token = makeToken();

    const res = await fetch(`http://127.0.0.1:${address.port}/api/v1/exchange/bid`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        bidId: "hfb-test-bid-1",
        advertiserId: "adv-exchange-001",
        adSlotId: "slot-prime-001",
        cpcBid: 2.50,
        attentionScore: 0.9
      })
    });

    assert.equal(res.status, 200);

    const body = await res.json() as {
      streamId: string;
      cleared: Array<{ won: boolean; effectiveCpc: number }>;
    };

    assert.match(body.streamId, /^\d+-\d+$/);
    assert.ok(Array.isArray(body.cleared));
  } finally {
    server.close();
  }
});

test("GET /api/v1/exchange/stats returns throughput counters", async () => {
  const server = app.listen(0);
  await once(server, "listening");

  try {
    const address = server.address() as { port: number };
    const token = makeToken();

    const res = await fetch(`http://127.0.0.1:${address.port}/api/v1/exchange/stats`, {
      headers: { authorization: `Bearer ${token}` }
    });

    assert.equal(res.status, 200);

    const body = await res.json() as {
      totalSubmitted: number;
      totalProcessed: number;
      totalDropped: number;
    };

    assert.ok(typeof body.totalSubmitted === "number");
    assert.ok(typeof body.totalProcessed === "number");
    assert.ok(typeof body.totalDropped === "number");
  } finally {
    server.close();
  }
});

after(() => {
  app.close();
});
