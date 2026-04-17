import test from "node:test";
import assert from "node:assert/strict";
import { AttentionHeatmapRenderer, Canvas2DLike, CanvasGradientLike, createHeatmapFrame } from "../src/advertiser-loop/AttentionHeatmapRenderer";
import { AuctionTickerController, buildTickerHealthScore, renderAuctionTicker } from "../src/advertiser-loop/AuctionTicker";
import { CampaignDuelService } from "../src/advertiser-loop/CampaignDuelService";
import { CompetitorAlertEngine } from "../src/advertiser-loop/CompetitorAlertEngine";
import {
  AudienceSegmentSnapshot,
  CampaignBidProfile,
  CampaignPerformanceSnapshot,
  CompetitorAlertContext,
  HeatmapFrame,
  RoiStreak
} from "../src/advertiser-loop/models";

class MockGradient implements CanvasGradientLike {
  readonly stops: Array<{ offset: number; color: string }> = [];

  addColorStop(offset: number, color: string): void {
    this.stops.push({ offset, color });
  }
}

class MockCanvasContext implements Canvas2DLike {
  canvas = { width: 0, height: 0 };
  globalAlpha = 1;
  fillStyle: string | CanvasGradientLike = "#000000";
  strokeStyle = "#000000";
  lineWidth = 1;
  font = "12px monospace";
  textAlign: "left" | "center" | "right" = "left";
  textBaseline: "top" | "middle" | "bottom" = "top";
  readonly operations: string[] = [];

  save(): void {
    this.operations.push("save");
  }

  restore(): void {
    this.operations.push("restore");
  }

  clearRect(x: number, y: number, width: number, height: number): void {
    this.operations.push(`clearRect:${x},${y},${width},${height}`);
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.operations.push(`fillRect:${x},${y},${width},${height}`);
  }

  strokeRect(x: number, y: number, width: number, height: number): void {
    this.operations.push(`strokeRect:${x},${y},${width},${height}`);
  }

  beginPath(): void {
    this.operations.push("beginPath");
  }

  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void {
    this.operations.push(`arc:${x},${y},${radius},${startAngle},${endAngle}`);
  }

  fill(): void {
    this.operations.push("fill");
  }

  stroke(): void {
    this.operations.push("stroke");
  }

  fillText(text: string, x: number, y: number): void {
    this.operations.push(`fillText:${text}@${x},${y}`);
  }

  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number
  ): CanvasGradientLike {
    this.operations.push(`gradient:${x0},${y0},${r0},${x1},${y1},${r1}`);
    return new MockGradient();
  }
}

class MockScheduler {
  handler: (() => void) | null = null;
  intervalMs = 0;
  setCalls = 0;
  clearCalls = 0;

  setInterval(handler: () => void, intervalMs: number): unknown {
    this.handler = handler;
    this.intervalMs = intervalMs;
    this.setCalls += 1;
    return { intervalMs };
  }

  clearInterval(_handle: unknown): void {
    this.clearCalls += 1;
    this.handler = null;
  }

  tick(): void {
    this.handler?.();
  }
}

const makeSegment = (): AudienceSegmentSnapshot => ({
  segmentId: "seg-gaming-high-focus",
  segmentName: "Gaming high-focus",
  category: "gaming",
  region: "NA",
  deviceMix: [
    { device: "desktop", share: 0.62 },
    { device: "mobile", share: 0.38 }
  ],
  verifiedLtv: 240,
  attentionScore: 0.86,
  conversionRate: 0.31,
  averageOrderValue: 135,
  activeAdvertisers: 7,
  categoryPressure: 1.34,
  impressionsPerMinute: 128,
  winningBid: 6.8,
  floorBid: 4.2,
  budgetCoverageHours: 11,
  attentionZones: [
    { id: "hero", label: "Hero CTA", x: 0, y: 0, width: 180, height: 120, weight: 1.2 },
    { id: "sidebar", label: "Sidebar", x: 180, y: 0, width: 140, height: 120, weight: 0.8 },
    { id: "footer", label: "Footer", x: 0, y: 120, width: 320, height: 80, weight: 0.55 }
  ],
  capturedAt: "2026-04-17T11:30:00.000Z"
});

const makeBidProfile = (campaignId: string, advertiserId: string, bid: number, budget: number): CampaignBidProfile => ({
  advertiserId,
  campaignId,
  campaignName: campaignId,
  baseOutcomePrice: 40,
  currentBid: bid,
  maxBid: 12,
  minBid: 2.5,
  budgetRemaining: budget,
  targetRoas: 2.2,
  verifiedLtv: 240,
  intentScore: 0.78,
  conversionRate: 0.3,
  recencyMultiplier: 1.08
});

const makePerformance = (
  campaignId: string,
  advertiserId: string,
  dailyBudget: number,
  bid: number,
  shareOfVoice: number,
  roas: number,
  attentionScore: number
): CampaignPerformanceSnapshot => ({
  campaignId,
  advertiserId,
  category: "gaming",
  budgetRemaining: dailyBudget * 0.72,
  dailyBudget,
  spendToday: round2(dailyBudget * 0.28),
  impressions: 1200,
  clicks: 188,
  outcomes: 42,
  conversions: 42,
  revenue: 1480,
  roi: round2(roas - 1),
  roas,
  averageCpc: 2.82,
  averageOutcomeCost: 10.24,
  attentionScore,
  shareOfVoice,
  bid,
  targetBid: bid + 0.8,
  targetRoas: 2.2,
  launchTs: "2026-04-10T09:00:00.000Z",
  updatedAt: "2026-04-17T11:30:00.000Z"
});

const makeStreak = (campaignId: string, advertiserId: string, profitableDays: number, roas: number): RoiStreak => ({
  campaignId,
  advertiserId,
  profitableDays,
  longestProfitableDays: profitableDays,
  lastProfitDate: "2026-04-17T00:00:00.000Z",
  currentRoas: roas,
  targetRoas: 2.2,
  consecutiveLossDays: roas < 2.2 ? 2 : 0,
  averageProfitPerDay: 240,
  lastSevenDayRoas: [2.4, 2.5, roas],
  statusLabel: `${profitableDays}-day streak`,
  momentum: profitableDays >= 7 ? "hot" : "warm"
});

const makeAlertContext = (): CompetitorAlertContext => ({
  segment: makeSegment(),
  focusCampaign: makePerformance("cmp-focus", "adv-focus", 180, 5.2, 0.24, 1.9, 0.57),
  focusStreak: {
    ...makeStreak("cmp-focus", "adv-focus", 0, 1.9),
    profitableDays: 0,
    longestProfitableDays: 5,
    consecutiveLossDays: 3,
    momentum: "cooling",
    statusLabel: "loss streak 3"
  },
  focusBidProfile: makeBidProfile("cmp-focus", "adv-focus", 5.2, 130),
  autopilotDecision: {
    decisionId: "dec-1",
    campaignId: "cmp-focus",
    advertiserId: "adv-focus",
    segmentId: "seg-gaming-high-focus",
    currentBid: 5.2,
    recommendedBid: 6.1,
    percentChange: 17.31,
    confidence: 0.88,
    expectedLift: 14.2,
    expectedSavings: 128.4,
    riskScore: 0.31,
    rationale: ["pressure high"],
    trustMessage: "Autopilot suggests raising the bid before attention peaks.",
    executeBy: "2026-04-17T11:50:00.000Z",
    createdAt: "2026-04-17T11:35:00.000Z"
  },
  competitors: [
    {
      advertiserId: "adv-rival-1",
      campaignId: "cmp-rival-1",
      campaignName: "Rival One",
      category: "gaming",
      segmentId: "seg-gaming-high-focus",
      region: "NA",
      budgetRemaining: 320,
      dailyBudget: 420,
      currentBid: 7.4,
      shareOfVoice: 0.46,
      attentionScore: 0.78,
      roi: 1.4,
      roas: 2.4,
      growthRate: 0.22,
      launchedAt: "2026-04-16T11:00:00.000Z",
      updatedAt: "2026-04-17T11:34:00.000Z"
    },
    {
      advertiserId: "adv-rival-2",
      campaignId: "cmp-rival-2",
      campaignName: "Rival Two",
      category: "gaming",
      segmentId: "seg-gaming-high-focus",
      region: "NA",
      budgetRemaining: 210,
      dailyBudget: 250,
      currentBid: 6.2,
      shareOfVoice: 0.31,
      attentionScore: 0.69,
      roi: 0.9,
      roas: 1.8,
      growthRate: 0.16,
      launchedAt: "2026-04-16T15:00:00.000Z",
      updatedAt: "2026-04-17T11:33:00.000Z"
    }
  ]
});

const makeHeatmapFrames = (): HeatmapFrame[] => {
  const zones = makeSegment().attentionZones;
  return [
    createHeatmapFrame({
      frameId: "frame-1",
      campaignId: "cmp-focus",
      segmentId: "seg-gaming-high-focus",
      width: 320,
      height: 200,
      zones,
      previousAttention: 0.52,
      samples: [
        {
          sampleId: "sample-1",
          timestamp: "2026-04-17T11:30:00.000Z",
          x: 72,
          y: 48,
          intensity: 0.91,
          dwellMs: 380,
          attentionScore: 0.9,
          engagementScore: 0.76,
          focusScore: 0.84,
          zoneId: "hero"
        },
        {
          sampleId: "sample-2",
          timestamp: "2026-04-17T11:30:01.000Z",
          x: 228,
          y: 52,
          intensity: 0.45,
          dwellMs: 160,
          attentionScore: 0.44,
          engagementScore: 0.4,
          focusScore: 0.43,
          zoneId: "sidebar"
        }
      ]
    }),
    createHeatmapFrame({
      frameId: "frame-2",
      campaignId: "cmp-focus",
      segmentId: "seg-gaming-high-focus",
      width: 320,
      height: 200,
      zones,
      previousAttention: 0.67,
      samples: [
        {
          sampleId: "sample-3",
          timestamp: "2026-04-17T11:35:00.000Z",
          x: 110,
          y: 62,
          intensity: 0.88,
          dwellMs: 420,
          attentionScore: 0.84,
          engagementScore: 0.78,
          focusScore: 0.81,
          zoneId: "hero"
        },
        {
          sampleId: "sample-4",
          timestamp: "2026-04-17T11:35:02.000Z",
          x: 148,
          y: 154,
          intensity: 0.58,
          dwellMs: 240,
          attentionScore: 0.61,
          engagementScore: 0.54,
          focusScore: 0.56,
          zoneId: "footer"
        }
      ]
    })
  ];
};

const round2 = (value: number): number => Number(value.toFixed(2));

test("CompetitorAlertEngine surfaces budget pressure, rank loss, and streak risk", () => {
  const engine = new CompetitorAlertEngine();
  const evaluation = engine.evaluate(makeAlertContext());

  assert.ok(evaluation.alerts.length >= 4);
  assert.equal(evaluation.highestSeverity, "critical");
  assert.ok(evaluation.averageCompetitorBid > 6);
  assert.ok(evaluation.recommendedBidFloor >= 6);
  assert.ok(evaluation.alerts.some((alert) => alert.type === "budget-defense"));
  assert.ok(evaluation.alerts.some((alert) => alert.type === "rank-loss"));
  assert.ok(evaluation.alerts.some((alert) => alert.type === "roi-streak-risk"));
});

test("CampaignDuelService runs duel rounds, updates streaks, and settles refunds", () => {
  const service = new CampaignDuelService();
  const duel = service.createDuel({
    segment: makeSegment(),
    contestants: [
      {
        advertiserId: "adv-alpha",
        campaignId: "cmp-alpha",
        campaignName: "Alpha",
        bidProfile: makeBidProfile("cmp-alpha", "adv-alpha", 6.3, 190),
        performance: makePerformance("cmp-alpha", "adv-alpha", 220, 6.3, 0.41, 2.7, 0.75),
        streak: makeStreak("cmp-alpha", "adv-alpha", 6, 2.7)
      },
      {
        advertiserId: "adv-bravo",
        campaignId: "cmp-bravo",
        campaignName: "Bravo",
        bidProfile: makeBidProfile("cmp-bravo", "adv-bravo", 5.1, 280),
        performance: makePerformance("cmp-bravo", "adv-bravo", 430, 5.1, 0.27, 1.9, 0.58),
        streak: {
          ...makeStreak("cmp-bravo", "adv-bravo", 0, 1.9),
          longestProfitableDays: 4,
          consecutiveLossDays: 2,
          profitableDays: 0,
          momentum: "cooling",
          statusLabel: "loss streak 2"
        }
      }
    ]
  });

  const [alpha, bravo] = duel.contestants;
  service.activateDuel(duel.duelId, "2026-04-17T11:32:00.000Z");
  service.adjustBid({ duelId: duel.duelId, contestantId: bravo.contestantId, bid: 6.8 });

  const round = service.runRound({
    duelId: duel.duelId,
    startedAt: "2026-04-17T11:35:00.000Z",
    endedAt: "2026-04-17T11:40:00.000Z",
    audiencePressure: 1.38,
    heat: 0.93,
    telemetryByContestant: {
      [alpha.contestantId]: {
        impressionsWon: 720,
        attentionCapture: 0.88,
        conversions: 18,
        spend: 94,
        revenue: 420,
        shareOfVoice: 0.54,
        reactionLatencyMs: 105
      },
      [bravo.contestantId]: {
        impressionsWon: 460,
        attentionCapture: 0.59,
        conversions: 9,
        spend: 122,
        revenue: 185,
        shareOfVoice: 0.31,
        reactionLatencyMs: 220
      }
    }
  });

  assert.equal(round.autopilotDecisions.length, 2);
  assert.equal(round.winningContestantId, alpha.contestantId);
  assert.ok(round.alerts.length > 0);
  assert.ok(round.alerts.some((alert) => alert.type === "budget-defense"));

  const streak = service.recordProfitDay({
    duelId: duel.duelId,
    contestantId: alpha.contestantId,
    profit: 220,
    revenue: 420,
    spend: 94,
    occurredAt: "2026-04-17T23:59:00.000Z"
  });
  assert.equal(streak.profitableDays, 7);
  assert.equal(streak.momentum, "hot");

  const settlement = service.settleDuel(duel.duelId, "2026-04-17T11:45:00.000Z");
  assert.equal(settlement.winnerContestantId, alpha.contestantId);
  assert.ok(settlement.loserRefundAmount > 100);

  const snapshot = service.getTickerSnapshot(duel.duelId);
  assert.equal(snapshot.duel.status, "settled");
  assert.ok(snapshot.events.some((event) => event.category === "autopilot"));
  assert.ok(snapshot.events.some((event) => event.category === "roi"));
});

test("AuctionTicker renders duel drama, alerts, and autopilot panels", () => {
  const service = new CampaignDuelService();
  const duel = service.createDuel({
    segment: makeSegment(),
    contestants: [
      {
        advertiserId: "adv-alpha",
        campaignId: "cmp-alpha",
        campaignName: "Alpha",
        bidProfile: makeBidProfile("cmp-alpha", "adv-alpha", 6.3, 190),
        performance: makePerformance("cmp-alpha", "adv-alpha", 220, 6.3, 0.41, 2.7, 0.75),
        streak: makeStreak("cmp-alpha", "adv-alpha", 6, 2.7)
      },
      {
        advertiserId: "adv-bravo",
        campaignId: "cmp-bravo",
        campaignName: "Bravo",
        bidProfile: makeBidProfile("cmp-bravo", "adv-bravo", 5.1, 280),
        performance: makePerformance("cmp-bravo", "adv-bravo", 430, 5.1, 0.27, 1.9, 0.58),
        streak: {
          ...makeStreak("cmp-bravo", "adv-bravo", 0, 1.9),
          profitableDays: 0,
          consecutiveLossDays: 3,
          momentum: "cooling",
          statusLabel: "loss streak 3"
        }
      }
    ]
  });

  service.runRound({
    duelId: duel.duelId,
    startedAt: "2026-04-17T11:35:00.000Z",
    endedAt: "2026-04-17T11:40:00.000Z",
    audiencePressure: 1.41,
    heat: 0.91,
    telemetryByContestant: {
      [duel.contestants[0].contestantId]: {
        impressionsWon: 690,
        attentionCapture: 0.84,
        conversions: 14,
        spend: 88,
        revenue: 390,
        shareOfVoice: 0.51,
        reactionLatencyMs: 120
      },
      [duel.contestants[1].contestantId]: {
        impressionsWon: 420,
        attentionCapture: 0.56,
        conversions: 7,
        spend: 118,
        revenue: 150,
        shareOfVoice: 0.29,
        reactionLatencyMs: 240
      }
    }
  });

  const snapshot = service.getTickerSnapshot(duel.duelId);
  const decisions = snapshot.latestRound?.autopilotDecisions ?? [];
  const alerts = snapshot.latestRound?.alerts ?? [];
  const streaks = snapshot.duel.contestants.map((contestant) => contestant.streak);

  const controller = new AuctionTickerController({
    duelFeed: [snapshot.duel],
    eventFeed: snapshot.events,
    alerts,
    streaks,
    autopilotDecisions: decisions
  });

  let latestHeadline = "";
  controller.subscribe((tickerSnapshot) => {
    latestHeadline = tickerSnapshot.viewModel.headline;
  });
  controller.pushAuctionDrama(snapshot.duel);

  const viewModel = renderAuctionTicker({
    duelFeed: [snapshot.duel],
    eventFeed: snapshot.events,
    alerts,
    streaks,
    autopilotDecisions: decisions
  });

  assert.match(viewModel.headline, /market/i);
  assert.ok(viewModel.feed.some((lane) => lane.laneId === "autopilot" && lane.events.length > 0));
  assert.ok(viewModel.alertPanel.total > 0);
  assert.ok(viewModel.duelPanel.activeDuels >= 1);
  assert.ok(viewModel.autopilotPanel.averageLift > 0);
  assert.ok(viewModel.summaryCards.length >= 4);
  assert.ok(buildTickerHealthScore(viewModel) > 0);
  assert.ok(latestHeadline.length > 0);
});

test("AttentionHeatmapRenderer produces deterministic zone and legend snapshots", () => {
  const ctx = new MockCanvasContext();
  const scheduler = new MockScheduler();
  const renderer = new AttentionHeatmapRenderer(ctx, { title: "Quantads BCI Heatmap" }, scheduler);
  const frames = makeHeatmapFrames();

  const first = renderer.setFrames(frames);
  assert.ok(first);
  assert.equal(first?.stats.sampleCount, 2);
  assert.equal(first?.zones[0]?.zoneId, "hero");
  assert.equal(first?.stats.hottestZoneLabel, "Hero CTA");
  assert.ok(ctx.operations.some((operation) => operation.startsWith("gradient:")));
  assert.ok(ctx.operations.some((operation) => operation.includes("Legend")));

  renderer.startLiveMode();
  assert.equal(renderer.isLive(), true);
  assert.equal(scheduler.setCalls, 1);
  assert.equal(scheduler.intervalMs, 5000);

  scheduler.tick();
  const second = renderer.getLastSnapshot();
  assert.equal(second?.frameId, "frame-2");
  assert.equal(second?.zones.find((zone) => zone.zoneId === "footer")?.sampleCount, 1);
  assert.match(renderer.describeCurrentFrame(), /hottest zone/i);

  renderer.stopLiveMode();
  assert.equal(renderer.isLive(), false);
  assert.equal(scheduler.clearCalls, 1);
});
