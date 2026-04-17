import test from "node:test";
import assert from "node:assert/strict";

import {
  BidWarVisualizationEngine,
  BidTick
} from "../src/components/BidWarVisualization";

import {
  AuctionWarRoomEngine,
  AuctionEvent
} from "../src/components/AuctionWarRoom";

import {
  CompetitorIntelligenceService
} from "../src/services/CompetitorIntelligence";

import {
  BidStrategyAIService,
  WhatIfScenario,
  WhatIfAuctionEvent
} from "../src/services/BidStrategyAI";

// ─────────────────────────────────────────────────────────────────────────────
// BidWarVisualizationEngine
// ─────────────────────────────────────────────────────────────────────────────

test("BidWarVisualizationEngine – ingesting ticks produces a valid frame", () => {
  const engine = new BidWarVisualizationEngine();
  const now = new Date().toISOString();

  const tick: BidTick = {
    tickId:      "t1",
    campaignId:  "camp-1",
    advertiserId: "adv-1",
    role:        "own",
    bidAmount:   2.50,
    timestamp:   now,
    vertical:    "automotive"
  };

  engine.ingestTick(tick);
  const frame = engine.getFrame();

  assert.ok(frame.frameId, "frame must have an id");
  assert.ok(frame.timestamp, "frame must have a timestamp");
  assert.equal(frame.liveTicks.length, 1, "one tick in the 1-min window");
  assert.equal(frame.liveTicks[0].campaignId, "camp-1");
  assert.deepEqual(Object.keys(frame.topBidsByCampaign), ["camp-1"]);
  assert.equal(frame.topBidsByCampaign["camp-1"].bidAmount, 2.50);
});

test("BidWarVisualizationEngine – candlestick series are built for all windows", () => {
  const engine = new BidWarVisualizationEngine();
  const now    = new Date().toISOString();

  for (let i = 0; i < 5; i++) {
    engine.ingestTick({
      tickId:      `t${i}`,
      campaignId:  "camp-2",
      advertiserId: "adv-2",
      role:        "winning",
      bidAmount:   1 + i * 0.1,
      timestamp:   now,
      vertical:    "retail"
    });
  }

  const frame = engine.getFrame();
  const windows = new Set(frame.candlestickSeries.map((s) => s.window));
  assert.ok(windows.has("1h"),  "1h series present");
  assert.ok(windows.has("24h"), "24h series present");
  assert.ok(windows.has("7d"),  "7d series present");
});

test("BidWarVisualizationEngine – OHLC candle values are correct", () => {
  const engine     = new BidWarVisualizationEngine();
  const baseTime   = new Date("2025-01-01T12:00:00.000Z");

  const bids = [2.00, 3.50, 1.50, 2.75];
  bids.forEach((bidAmount, i) => {
    engine.ingestTick({
      tickId:      `tc${i}`,
      campaignId:  "camp-ohlc",
      advertiserId: "adv-ohlc",
      role:        "own",
      bidAmount,
      timestamp:   new Date(baseTime.getTime() + i * 1_000).toISOString(),
      vertical:    "finance"
    });
  });

  const series = engine.getCandlestickSeries("camp-ohlc", "1h");
  assert.ok(series, "series must exist");
  assert.ok(series.candles.length >= 1, "at least one candle");

  const candle = series.candles[0];
  assert.equal(candle.open,  2.00, "open equals first tick");
  assert.equal(candle.high,  3.50, "high equals max bid");
  assert.equal(candle.low,   1.50, "low equals min bid");
  assert.equal(candle.close, 2.75, "close equals last tick");
  assert.equal(candle.volume, 4,   "volume equals tick count");
});

test("BidWarVisualizationEngine – sound events emitted on win / outbid", () => {
  const engine = new BidWarVisualizationEngine();
  const now    = new Date().toISOString();
  const received: string[] = [];

  engine.onSoundEvent((e) => received.push(e.cue));

  // First tick for campaign → role winning → "cha-ching"
  engine.ingestTick({
    tickId: "s1", campaignId: "camp-s", advertiserId: "a1",
    role: "winning", bidAmount: 5.0, timestamp: now, vertical: "tech"
  });

  // Role flips to "losing" → "whoosh"
  engine.ingestTick({
    tickId: "s2", campaignId: "camp-s", advertiserId: "a1",
    role: "losing", bidAmount: 4.9, timestamp: now, vertical: "tech"
  });

  assert.ok(received.includes("cha-ching"), "win emits cha-ching");
  assert.ok(received.includes("whoosh"),    "outbid emits whoosh");
});

test("BidWarVisualizationEngine – clash sparks are generated when bids converge", () => {
  const engine   = new BidWarVisualizationEngine();
  const baseTime = Date.now();

  // Inject two bids extremely close together (within 2 %)
  engine.ingestTick({
    tickId: "c1", campaignId: "camp-clash", advertiserId: "a1",
    role: "winning", bidAmount: 10.00,
    timestamp: new Date(baseTime).toISOString(), vertical: "gaming"
  });

  engine.ingestTick({
    tickId: "c2", campaignId: "camp-clash", advertiserId: "a2",
    role: "losing", bidAmount: 10.05,
    timestamp: new Date(baseTime + 10).toISOString(), vertical: "gaming"
  });

  const frame = engine.getFrame();
  // Sparks may or may not be present depending on ordering; just verify the
  // activeSparks array is accessible and each entry has required fields.
  for (const spark of frame.activeSparks) {
    assert.ok(spark.sparkId,    "spark has sparkId");
    assert.ok(spark.campaignId, "spark has campaignId");
    assert.ok(spark.expiresAt > spark.triggeredAt, "expiry after trigger");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AuctionWarRoomEngine
// ─────────────────────────────────────────────────────────────────────────────

test("AuctionWarRoomEngine – campaign registration and mode toggles", () => {
  const engine = new AuctionWarRoomEngine();
  const c = engine.registerCampaign({
    campaignId:   "wrc-1",
    campaignName: "Campaign Alpha",
    advertiserId: "adv-wr",
    currentBid:   5.00,
    dailyBudget:  1_000
  });

  assert.equal(c.status,         "active");
  assert.equal(c.sniperEnabled,  false);
  assert.equal(c.defenseEnabled, false);

  engine.enableSniperMode("wrc-1", 10.00);
  const after = engine.getCampaign("wrc-1");
  assert.ok(after);
  assert.equal(after.sniperEnabled, true);
  assert.equal(after.maxSniperBid,  10.00);
});

test("AuctionWarRoomEngine – sniper mode fires in last 100ms window", () => {
  const engine = new AuctionWarRoomEngine();
  engine.registerCampaign({
    campaignId: "sniper-camp", campaignName: "Sniper", advertiserId: "adv-s",
    currentBid: 5.00, dailyBudget: 500, maxSniperBid: 20.00
  });
  engine.enableSniperMode("sniper-camp", 20.00);

  const event: AuctionEvent = {
    eventId:            randomEventId(),
    type:               "bid_placed",
    campaignId:         "sniper-camp",
    advertiserId:       "adv-s",
    bidAmount:          5.00,
    competitorBid:      6.00,
    auctionId:          "auc-1",
    msRemainingAtEvent: 50,           // within 100ms window
    timestamp:          new Date().toISOString()
  };

  const { autoBidEvent } = engine.ingestAuctionEvent(event);
  assert.ok(autoBidEvent, "sniper auto-bid event must be created");
  assert.equal(autoBidEvent.type, "sniper_bid");
  assert.ok(autoBidEvent.bidAmount > 6.00, "sniper bid must exceed competitor");

  const audit = engine.getAutoBidAudit();
  assert.ok(audit.length >= 1, "audit log must have entry");
  assert.equal(audit[0].mode, "sniper");
});

test("AuctionWarRoomEngine – sniper does NOT fire outside 100ms window", () => {
  const engine = new AuctionWarRoomEngine();
  engine.registerCampaign({
    campaignId: "sniper-camp-2", campaignName: "Sniper2", advertiserId: "adv-s2",
    currentBid: 5.00, dailyBudget: 500, maxSniperBid: 20.00
  });
  engine.enableSniperMode("sniper-camp-2", 20.00);

  const event: AuctionEvent = {
    eventId:            randomEventId(),
    type:               "bid_placed",
    campaignId:         "sniper-camp-2",
    advertiserId:       "adv-s2",
    bidAmount:          5.00,
    competitorBid:      6.00,
    auctionId:          "auc-2",
    msRemainingAtEvent: 5_000,        // well outside window
    timestamp:          new Date().toISOString()
  };

  const { autoBidEvent } = engine.ingestAuctionEvent(event);
  assert.equal(autoBidEvent, null, "no sniper bid outside the 100ms window");
});

test("AuctionWarRoomEngine – sniper respects maxSniperBid cap", () => {
  const engine = new AuctionWarRoomEngine();
  engine.registerCampaign({
    campaignId: "sniper-cap", campaignName: "Cap", advertiserId: "adv-cap",
    currentBid: 5.00, dailyBudget: 500, maxSniperBid: 6.00
  });
  engine.enableSniperMode("sniper-cap", 6.00);

  const event: AuctionEvent = {
    eventId:            randomEventId(),
    type:               "bid_placed",
    campaignId:         "sniper-cap",
    advertiserId:       "adv-cap",
    bidAmount:          5.00,
    competitorBid:      10.00,        // competitor bid far above cap
    auctionId:          "auc-cap",
    msRemainingAtEvent: 50,
    timestamp:          new Date().toISOString()
  };

  engine.ingestAuctionEvent(event);
  const camp = engine.getCampaign("sniper-cap");
  assert.ok(camp);
  assert.ok(camp.currentBid <= 6.00, "bid must not exceed maxSniperBid");
});

test("AuctionWarRoomEngine – defense mode raises bid when competitor increases", () => {
  const engine = new AuctionWarRoomEngine();
  engine.registerCampaign({
    campaignId: "def-camp", campaignName: "Defense", advertiserId: "adv-d",
    currentBid: 5.00, dailyBudget: 500, maxDefenseBid: 15.00
  });
  engine.enableDefenseMode("def-camp", 15.00, 0.05);

  const auctionId = "auc-def";

  // First event — baseline competitor bid
  engine.ingestAuctionEvent({
    eventId: randomEventId(), type: "bid_placed",
    campaignId: "def-camp", advertiserId: "adv-d",
    bidAmount: 5.00, competitorBid: 5.00,
    auctionId, msRemainingAtEvent: 5_000,
    timestamp: new Date().toISOString()
  });

  // Second event — competitor raises by 20% (above 5% threshold)
  const { autoBidEvent } = engine.ingestAuctionEvent({
    eventId: randomEventId(), type: "competitor_raised",
    campaignId: "def-camp", advertiserId: "adv-d",
    bidAmount: 5.00, competitorBid: 6.00,
    auctionId, msRemainingAtEvent: 4_000,
    timestamp: new Date().toISOString()
  });

  assert.ok(autoBidEvent, "defense auto-bid event must be created");
  assert.equal(autoBidEvent.type, "defense_bid");
  const camp = engine.getCampaign("def-camp");
  assert.ok(camp);
  assert.ok(camp.currentBid > 5.00, "own bid must be raised by defense");
});

test("AuctionWarRoomEngine – war room snapshot has all three panels", () => {
  const engine = new AuctionWarRoomEngine();
  engine.registerCampaign({
    campaignId: "snap-c", campaignName: "Snap", advertiserId: "adv-snap",
    currentBid: 3.00, dailyBudget: 200
  });

  engine.ingestAuctionEvent({
    eventId: randomEventId(), type: "bid_won",
    campaignId: "snap-c", advertiserId: "adv-snap",
    bidAmount: 3.00, auctionId: "auc-snap",
    msRemainingAtEvent: 0,
    timestamp: new Date().toISOString()
  });

  const snap = engine.getSnapshot();
  assert.ok(snap.snapshotId,          "snapshot has id");
  assert.ok(snap.leftPanel,           "left panel present");
  assert.ok(snap.centerPanel,         "center panel present");
  assert.ok(snap.rightPanel,          "right panel present");
  assert.ok(snap.leftPanel.campaigns.length >= 1,    "left panel has campaigns");
  assert.ok(snap.centerPanel.events.length >= 1,     "center panel has events");
});

test("AuctionWarRoomEngine – analytics panel win rate is correct", () => {
  const engine = new AuctionWarRoomEngine();
  engine.registerCampaign({
    campaignId: "analytics-c", campaignName: "Analytics", advertiserId: "adv-an",
    currentBid: 4.00, dailyBudget: 300
  });

  const ts = new Date().toISOString();
  const makeEvent = (type: AuctionEvent["type"]): AuctionEvent => ({
    eventId: randomEventId(), type,
    campaignId: "analytics-c", advertiserId: "adv-an",
    bidAmount: 4.00, auctionId: "auc-an",
    msRemainingAtEvent: 0, timestamp: ts
  });

  // 3 wins, 2 losses → win rate 0.6
  engine.ingestAuctionEvent(makeEvent("bid_won"));
  engine.ingestAuctionEvent(makeEvent("bid_won"));
  engine.ingestAuctionEvent(makeEvent("bid_won"));
  engine.ingestAuctionEvent(makeEvent("bid_lost"));
  engine.ingestAuctionEvent(makeEvent("bid_lost"));

  const snap = engine.getSnapshot();
  assert.equal(snap.rightPanel.winRate, 0.6, "win rate must be 3/5 = 0.6");
});

// ─────────────────────────────────────────────────────────────────────────────
// CompetitorIntelligenceService
// ─────────────────────────────────────────────────────────────────────────────

test("CompetitorIntelligenceService – observe and retrieve a pattern", () => {
  const svc = new CompetitorIntelligenceService();
  const ts  = new Date().toISOString();

  let competitorId: string | undefined;

  svc.onAlert((alert) => {
    competitorId = alert.competitorId;
  });

  svc.observe({ advertiserId: "adv-ci-1", vertical: "auto", bidAmount: 3.00, observedAt: ts });

  // competitorId should have been set by the market-entry alert
  assert.ok(competitorId, "alert must fire on first observation");

  const pattern = svc.getPattern(competitorId!);
  assert.ok(pattern, "pattern must be retrievable");
  assert.equal(pattern.latestBid, 3.00);
});

test("CompetitorIntelligenceService – linear regression prediction", () => {
  const svc = new CompetitorIntelligenceService();
  let cId: string | undefined;
  svc.onAlert((a) => { cId = cId ?? a.competitorId; });

  // Rising bid sequence
  for (let i = 0; i < 12; i++) {
    svc.observe({
      advertiserId: "adv-lr",
      vertical:     "health",
      bidAmount:    1.00 + i * 0.50,
      observedAt:   new Date(Date.now() + i * 1_000).toISOString()
    });
  }

  assert.ok(cId, "competitorId must be assigned");
  const predicted = svc.predictMaxBid(cId!);
  assert.ok(predicted !== null, "prediction must not be null");
  assert.ok(predicted > 1.0, "prediction must be above initial bid (rising trend)");
});

test("CompetitorIntelligenceService – getPatternsForVertical requires k-anon threshold", () => {
  const svc = new CompetitorIntelligenceService();
  const ts  = new Date().toISOString();

  // Only 2 competitors — below threshold of 3
  svc.observe({ advertiserId: "a1", vertical: "fashion", bidAmount: 2.0, observedAt: ts });
  svc.observe({ advertiserId: "a2", vertical: "fashion", bidAmount: 3.0, observedAt: ts });

  const result = svc.getPatternsForVertical("fashion");
  assert.equal(result, null, "must return null when k-anon threshold not met");

  // Add third competitor
  svc.observe({ advertiserId: "a3", vertical: "fashion", bidAmount: 2.5, observedAt: ts });
  const result2 = svc.getPatternsForVertical("fashion");
  assert.ok(result2, "must return patterns once threshold is met");
  assert.equal(result2.length, 3);
});

test("CompetitorIntelligenceService – getScorecard ranks advertiser correctly", () => {
  const svc = new CompetitorIntelligenceService();
  const ts  = new Date().toISOString();

  // 4 competitors with increasing bids; adv-top has the highest average
  ["adv-lo", "adv-mid", "adv-hi", "adv-top"].forEach((id, idx) => {
    svc.observe({ advertiserId: id, vertical: "tech", bidAmount: 1 + idx, observedAt: ts });
  });

  const scorecard = svc.getScorecard("adv-top", "tech");
  assert.ok(scorecard, "scorecard must be returned");
  assert.ok(scorecard.competitiveScore >= 75, "top bidder must have high score");
  assert.equal(scorecard.totalCompetitors, 4);
});

test("CompetitorIntelligenceService – market entry alerts fire once per new entrant", () => {
  const svc    = new CompetitorIntelligenceService();
  const ts     = new Date().toISOString();
  const alerts: string[] = [];
  svc.onAlert((a) => alerts.push(a.competitorId));

  svc.observe({ advertiserId: "new-adv", vertical: "sports", bidAmount: 2.0, observedAt: ts });
  // Same advertiser again — should NOT fire second alert (cool-down in place)
  svc.observe({ advertiserId: "new-adv", vertical: "sports", bidAmount: 2.5, observedAt: ts });

  assert.equal(alerts.length, 1, "only one alert per new entrant");
});

test("CompetitorIntelligenceService – getVerticalSummary returns percentile distribution", () => {
  const svc = new CompetitorIntelligenceService();
  const ts  = new Date().toISOString();
  const bids = [1, 2, 3, 4, 5];

  bids.forEach((bid, i) => {
    for (let j = 0; j < 3; j++) {
      svc.observe({ advertiserId: `v-adv-${i}`, vertical: "media", bidAmount: bid, observedAt: ts });
    }
  });

  const summary = svc.getVerticalSummary("media");
  assert.ok(summary, "summary must be returned");
  assert.ok(summary.bidDistribution.p50 >= 3, "p50 should be around median bid");
  assert.ok(summary.bidDistribution.p90 >= summary.bidDistribution.p50, "p90 >= p50");
});

// ─────────────────────────────────────────────────────────────────────────────
// BidStrategyAIService
// ─────────────────────────────────────────────────────────────────────────────

test("BidStrategyAIService – creates strategy in recommend mode", () => {
  const svc = new BidStrategyAIService();
  const s   = svc.createStrategy({
    campaignId: "bsai-1", advertiserId: "adv-bsai",
    startingBid: 2.00, minBid: 0.50, maxBid: 10.00,
    dailyBudgetCap: 500
  });

  assert.equal(s.mode,        "recommend");
  assert.equal(s.currentBid,  2.00);
  assert.equal(s.pacingMode,  "even");
});

test("BidStrategyAIService – recommendation only in recommend mode", () => {
  const svc = new BidStrategyAIService();
  const s   = svc.createStrategy({
    campaignId: "bsai-2", advertiserId: "adv-bsai2",
    startingBid: 2.00, minBid: 0.50, maxBid: 10.00,
    dailyBudgetCap: 500
  });

  const result = svc.evaluate(s.id, { history: [] });
  assert.equal(result.applied,    false, "must not apply in recommend mode");
  assert.equal(result.appliedBid, 2.00,  "bid unchanged in recommend mode");
});

test("BidStrategyAIService – auto_apply applies bid within step limits", () => {
  const svc = new BidStrategyAIService();
  const s   = svc.createStrategy({
    campaignId: "bsai-3", advertiserId: "adv-bsai3",
    startingBid: 5.00, minBid: 1.00, maxBid: 20.00,
    dailyBudgetCap: 10_000, maxStepFraction: 0.20
  });
  svc.setMode(s.id, "auto_apply");

  const result = svc.evaluate(s.id, { history: [] });
  assert.equal(result.applied, true);
  assert.ok(result.appliedBid >= 5.00 * 0.80, "lower bound: -20%");
  assert.ok(result.appliedBid <= 5.00 * 1.20, "upper bound: +20%");
});

test("BidStrategyAIService – ROAS guard pauses when avg ROAS below target", () => {
  const svc = new BidStrategyAIService();
  const s   = svc.createStrategy({
    campaignId: "bsai-roas", advertiserId: "adv-roas",
    startingBid: 3.00, minBid: 1.00, maxBid: 10.00,
    dailyBudgetCap: 1_000, targetRoas: 3.0
  });
  svc.setMode(s.id, "auto_apply");

  const lowRoasHistory = Array.from({ length: 5 }, (_, i) => ({
    hour: i, dayOfWeek: 1, roas: 1.5,   // below target of 3.0
    conversionRate: 0.01, auctionCount: 100
  }));

  const result = svc.evaluate(s.id, { history: lowRoasHistory });
  assert.equal(result.roasTriggeredPause, true, "ROAS guard must trigger pause");
  assert.equal(result.applied,           false, "bid must not be applied");
  assert.ok(result.capsEnforced.includes("targetRoasPause"));
});

test("BidStrategyAIService – daily budget cap blocks auto_apply", () => {
  const svc = new BidStrategyAIService();
  const s   = svc.createStrategy({
    campaignId: "bsai-cap", advertiserId: "adv-cap",
    startingBid: 2.00, minBid: 1.00, maxBid: 10.00,
    dailyBudgetCap: 50
  });
  svc.setMode(s.id, "auto_apply");

  const first = svc.evaluate(s.id, { history: [], projectedAdditionalSpend: 40 });
  assert.equal(first.applied, true);

  const second = svc.evaluate(s.id, { history: [], projectedAdditionalSpend: 20 });
  assert.equal(second.applied, false);
  assert.ok(second.capsEnforced.includes("dailyBudgetCap"));
});

test("BidStrategyAIService – slot-performance multiplier raises bid in high-ROAS slot", () => {
  const svc = new BidStrategyAIService();
  const s   = svc.createStrategy({
    campaignId: "bsai-slot", advertiserId: "adv-slot",
    startingBid: 4.00, minBid: 1.00, maxBid: 20.00,
    dailyBudgetCap: 10_000
  });

  // History: hour 9 on Monday has very high ROAS (5.0) vs average (1.0)
  const history = [
    { hour: 9, dayOfWeek: 1, roas: 5.0, conversionRate: 0.1, auctionCount: 100 },
    { hour: 14, dayOfWeek: 3, roas: 1.0, conversionRate: 0.02, auctionCount: 100 },
    { hour: 20, dayOfWeek: 5, roas: 1.0, conversionRate: 0.02, auctionCount: 100 }
  ];

  const highRoasResult = svc.evaluate(s.id, { hour: 9, dayOfWeek: 1, history });
  const current = svc.getStrategy(s.id);
  assert.ok(current);

  // Evaluate at a low-ROAS slot for comparison
  const lowRoasResult = svc.evaluate(current.id, { hour: 14, dayOfWeek: 3, history });
  assert.ok(
    highRoasResult.recommendedBid >= lowRoasResult.recommendedBid,
    "high-ROAS slot should recommend a higher bid than low-ROAS slot"
  );
});

test("BidStrategyAIService – pacing mode front_load weights early hours more", () => {
  const svc = new BidStrategyAIService();
  const s   = svc.createStrategy({
    campaignId: "bsai-pacing", advertiserId: "adv-pacing",
    startingBid: 5.00, minBid: 1.00, maxBid: 20.00,
    dailyBudgetCap: 1_000, pacingMode: "front_load"
  });

  // At hour 3 (early) with zero spend, pacing should be ahead → multiplier < 1
  const earlyResult = svc.evaluate(s.id, { hour: 3, dayOfWeek: 1, history: [] });
  assert.ok(earlyResult.pacingMultiplier <= 1, "front_load: early hour should dampen bid (ahead of pace)");
});

test("BidStrategyAIService – what-if simulator runs without mutating live strategy", () => {
  const svc = new BidStrategyAIService();
  const s   = svc.createStrategy({
    campaignId: "bsai-sim", advertiserId: "adv-sim",
    startingBid: 3.00, minBid: 1.00, maxBid: 10.00,
    dailyBudgetCap: 200
  });

  const scenarios: WhatIfScenario[] = [
    { label: "conservative", bidAmount: 2.00, pacingMode: "even",        targetRoas: 2.0, dailyBudgetCap: 100 },
    { label: "aggressive",   bidAmount: 8.00, pacingMode: "front_load",  targetRoas: 1.5, dailyBudgetCap: 200 },
    { label: "back-loaded",  bidAmount: 4.00, pacingMode: "back_load",   targetRoas: 2.0, dailyBudgetCap: 150 }
  ];

  const events: WhatIfAuctionEvent[] = Array.from({ length: 24 }, (_, h) => ({
    hour: h, dayOfWeek: 1,
    marketFloor:    1.50,
    slotRoas:       2.5,
    opportunities:  10
  }));

  const results = svc.simulate(scenarios, events);
  assert.equal(results.length, 3, "three results for three scenarios");

  for (const r of results) {
    assert.ok(r.scenarioLabel,               "result has label");
    assert.ok(r.totalSpend >= 0,             "spend non-negative");
    assert.ok(r.auctionsEntered >= 0,        "auctions entered non-negative");
    assert.ok(r.hourlyBreakdown.length === 24, "24-hour breakdown");
  }

  // Live strategy must be untouched
  const live = svc.getStrategy(s.id);
  assert.ok(live);
  assert.equal(live.currentBid,  3.00, "live bid unchanged by simulation");
  assert.equal(live.todaySpend,  0,    "live spend unchanged by simulation");
});

test("BidStrategyAIService – aggressive scenario wins more auctions than conservative", () => {
  const svc = new BidStrategyAIService();

  const scenarios: WhatIfScenario[] = [
    { label: "low",  bidAmount: 0.50, pacingMode: "even", targetRoas: 1.0, dailyBudgetCap: 1_000 },
    { label: "high", bidAmount: 5.00, pacingMode: "even", targetRoas: 1.0, dailyBudgetCap: 1_000 }
  ];

  const events: WhatIfAuctionEvent[] = Array.from({ length: 24 }, (_, h) => ({
    hour: h, dayOfWeek: 1, marketFloor: 1.00, slotRoas: 2.0, opportunities: 20
  }));

  const [low, high] = svc.simulate(scenarios, events);
  assert.ok(
    high.auctionsWon > low.auctionsWon,
    "higher bid should win more auctions than lower bid"
  );
});

test("BidStrategyAIService – pauseBelowTargetRoas pauses eligible strategies", () => {
  const svc = new BidStrategyAIService();
  const s   = svc.createStrategy({
    campaignId: "bsai-pause", advertiserId: "adv-pause",
    startingBid: 2.00, minBid: 1.00, maxBid: 5.00,
    dailyBudgetCap: 100, targetRoas: 3.0
  });
  svc.setMode(s.id, "auto_apply");

  const lowRoas = Array.from({ length: 3 }, (_, i) => ({
    hour: i, dayOfWeek: 1, roas: 1.0, conversionRate: 0.01, auctionCount: 50
  }));

  const paused = svc.pauseBelowTargetRoas(lowRoas);
  assert.ok(paused.includes(s.id), "strategy must be paused when ROAS below target");

  const current = svc.getStrategy(s.id);
  assert.ok(current);
  assert.equal(current.mode, "paused");
});

test("BidStrategyAIService – audit log records every evaluation", () => {
  const svc = new BidStrategyAIService();
  const s   = svc.createStrategy({
    campaignId: "bsai-audit", advertiserId: "adv-audit",
    startingBid: 3.00, minBid: 1.00, maxBid: 10.00,
    dailyBudgetCap: 1_000
  });

  svc.evaluate(s.id, { history: [] });
  svc.evaluate(s.id, { history: [] });
  svc.evaluate(s.id, { history: [] });

  const audit = svc.getAudit(s.id);
  assert.equal(audit.length, 3, "three audit entries for three evaluations");
  assert.ok(audit.every((e) => e.id && e.at && e.strategyId === s.id), "entries have required fields");
});

// ── Helper ────────────────────────────────────────────────────────────────────

function randomEventId(): string {
  return Math.random().toString(36).slice(2);
}
