import { randomUUID } from "node:crypto";
import { BiddingEngine } from "../bidding/BiddingEngine";
import { CompetitorAlertEngine } from "./CompetitorAlertEngine";
import {
  AudienceSegmentSnapshot,
  BidAutopilotDecision,
  CampaignBidProfile,
  CampaignDuel,
  CampaignPerformanceSnapshot,
  CompetitorAlert,
  CompetitorSnapshot,
  DuelContestant,
  DuelRound,
  DuelRoundTelemetry,
  DuelSettlement,
  DuelStatus,
  RoiStreak,
  TickerEvent,
  clamp,
  createStatusLabel,
  formatCurrency,
  round,
  sum
} from "./models";

export interface CreateCampaignDuelRequest {
  segment: AudienceSegmentSnapshot;
  contestants: [DuelContestantSeed, DuelContestantSeed];
  createdAt?: string;
  status?: DuelStatus;
}

export interface DuelContestantSeed {
  advertiserId: string;
  campaignId: string;
  campaignName: string;
  bidProfile: CampaignBidProfile;
  performance: CampaignPerformanceSnapshot;
  autopilotEnabled?: boolean;
  streak?: Partial<RoiStreak>;
}

export interface CampaignDuelRoundInput {
  duelId: string;
  startedAt?: string;
  endedAt?: string;
  audiencePressure?: number;
  heat?: number;
  telemetryByContestant?: Record<string, Partial<DuelRoundTelemetry>>;
  externalCompetitors?: Record<string, CompetitorSnapshot[]>;
}

export interface ProfitDayInput {
  duelId: string;
  contestantId: string;
  profit: number;
  revenue: number;
  spend: number;
  occurredAt?: string;
}

export interface CampaignBidAdjustmentInput {
  duelId: string;
  contestantId: string;
  bid: number;
  updatedAt?: string;
  spendToday?: number;
  budgetRemaining?: number;
}

export interface DuelPortfolioSummary {
  activeDuels: number;
  settledDuels: number;
  totalRefundExposure: number;
  totalBidVolume: number;
  hottestSegment: string | null;
  autopilotEnabledContestants: number;
  activeAlerts: number;
}

export interface DuelTickerSnapshot {
  duel: CampaignDuel;
  latestRound: DuelRound | null;
  events: TickerEvent[];
}

export interface CampaignDuelServiceOptions {
  winnerVisibilityMultiplier: number;
  loserRefundShare: number;
  maxEventHistory: number;
  minimumHeat: number;
  autopilotLookaheadMinutes: number;
}

const DEFAULT_OPTIONS: CampaignDuelServiceOptions = {
  winnerVisibilityMultiplier: 2,
  loserRefundShare: 0.92,
  maxEventHistory: 250,
  minimumHeat: 0.45,
  autopilotLookaheadMinutes: 20
};

const DEFAULT_TELEMETRY: DuelRoundTelemetry = {
  impressionsWon: 0,
  attentionCapture: 0,
  conversions: 0,
  spend: 0,
  revenue: 0,
  shareOfVoice: 0,
  reactionLatencyMs: 0
};

const byContestantId = <T extends { contestantId: string }>(contestants: T[]): Record<string, T> => {
  return Object.fromEntries(contestants.map((contestant) => [contestant.contestantId, contestant]));
};

const summarizeRoi = (revenue: number, spend: number): { roi: number; roas: number } => {
  if (spend <= 0) {
    return { roi: revenue > 0 ? round(revenue, 2) : 0, roas: revenue > 0 ? round(revenue, 2) : 0 };
  }

  const roi = (revenue - spend) / spend;
  const roas = revenue / spend;
  return {
    roi: round(roi, 4),
    roas: round(roas, 4)
  };
};

const normalizeTelemetry = (telemetry: Partial<DuelRoundTelemetry> | undefined): DuelRoundTelemetry => {
  return {
    impressionsWon: telemetry?.impressionsWon ?? DEFAULT_TELEMETRY.impressionsWon,
    attentionCapture: telemetry?.attentionCapture ?? DEFAULT_TELEMETRY.attentionCapture,
    conversions: telemetry?.conversions ?? DEFAULT_TELEMETRY.conversions,
    spend: telemetry?.spend ?? DEFAULT_TELEMETRY.spend,
    revenue: telemetry?.revenue ?? DEFAULT_TELEMETRY.revenue,
    shareOfVoice: telemetry?.shareOfVoice ?? DEFAULT_TELEMETRY.shareOfVoice,
    reactionLatencyMs: telemetry?.reactionLatencyMs ?? DEFAULT_TELEMETRY.reactionLatencyMs
  };
};

const pushBounded = <T>(collection: T[], item: T, limit: number): void => {
  collection.push(item);
  if (collection.length > limit) {
    collection.splice(0, collection.length - limit);
  }
};

export class CampaignDuelService {
  private readonly biddingEngine = new BiddingEngine();
  private readonly alertEngine: CompetitorAlertEngine;
  private readonly options: CampaignDuelServiceOptions;
  private readonly duelsById = new Map<string, CampaignDuel>();
  private readonly eventsByDuelId = new Map<string, TickerEvent[]>();

  constructor(
    alertEngine = new CompetitorAlertEngine(),
    options: Partial<CampaignDuelServiceOptions> = {}
  ) {
    this.alertEngine = alertEngine;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  createDuel(request: CreateCampaignDuelRequest): CampaignDuel {
    const createdAt = request.createdAt ?? new Date().toISOString();
    const contestants = request.contestants.map((seed) => this.createContestant(seed, createdAt)) as [DuelContestant, DuelContestant];
    const duel: CampaignDuel = {
      duelId: randomUUID(),
      segment: request.segment,
      status: request.status ?? "pending",
      createdAt,
      updatedAt: createdAt,
      contestants,
      rounds: [],
      alertStream: []
    };

    this.duelsById.set(duel.duelId, duel);
    this.eventsByDuelId.set(duel.duelId, []);

    this.recordEvent(duel.duelId, {
      category: "duel",
      ts: createdAt,
      headline: `${contestants[0].campaignName} versus ${contestants[1].campaignName}`,
      body: `A fresh campaign duel opened for ${request.segment.segmentName} with ${round(request.segment.attentionScore * 100, 2)}% attention intensity.`,
      segmentId: request.segment.segmentId,
      segmentName: request.segment.segmentName,
      tags: ["duel", request.segment.category, request.segment.region],
      metadata: {
        duelId: duel.duelId,
        contestantA: contestants[0].campaignId,
        contestantB: contestants[1].campaignId,
        verifiedLtv: request.segment.verifiedLtv
      }
    });

    return duel;
  }

  activateDuel(duelId: string, activatedAt = new Date().toISOString()): CampaignDuel {
    const duel = this.requireDuel(duelId);
    duel.status = "active";
    duel.updatedAt = activatedAt;

    this.recordEvent(duelId, {
      category: "market",
      ts: activatedAt,
      headline: `Live duel started in ${duel.segment.segmentName}`,
      body: `Bid pressure is now public for ${duel.segment.activeAdvertisers} advertisers chasing this audience pocket.`,
      segmentId: duel.segment.segmentId,
      segmentName: duel.segment.segmentName,
      tags: ["live", "auction", duel.segment.category],
      metadata: {
        duelId,
        activeAdvertisers: duel.segment.activeAdvertisers,
        winningBid: duel.segment.winningBid,
        floorBid: duel.segment.floorBid
      }
    });

    return duel;
  }

  adjustBid(input: CampaignBidAdjustmentInput): DuelContestant {
    const duel = this.requireDuel(input.duelId);
    const contestant = this.requireContestant(duel, input.contestantId);
    const previousBid = contestant.bidProfile.currentBid;
    const updatedAt = input.updatedAt ?? new Date().toISOString();

    contestant.bidProfile.currentBid = round(clamp(input.bid, contestant.bidProfile.minBid, contestant.bidProfile.maxBid), 2);
    contestant.performance.bid = contestant.bidProfile.currentBid;

    if (typeof input.spendToday === "number") {
      contestant.performance.spendToday = round(input.spendToday, 2);
    }
    if (typeof input.budgetRemaining === "number") {
      contestant.performance.budgetRemaining = round(Math.max(input.budgetRemaining, 0), 2);
      contestant.bidProfile.budgetRemaining = contestant.performance.budgetRemaining;
    }

    contestant.performance.updatedAt = updatedAt;
    duel.updatedAt = updatedAt;

    this.recordEvent(duel.duelId, {
      category: "bid",
      ts: updatedAt,
      headline: `${contestant.campaignName} moved bid to ${formatCurrency(contestant.bidProfile.currentBid)}`,
      body: `Bid shifted by ${formatCurrency(contestant.bidProfile.currentBid - previousBid)} to defend ${duel.segment.segmentName}.`,
      segmentId: duel.segment.segmentId,
      segmentName: duel.segment.segmentName,
      actor: {
        advertiserId: contestant.advertiserId,
        campaignId: contestant.campaignId,
        displayName: contestant.campaignName
      },
      value: contestant.bidProfile.currentBid,
      changePercent: previousBid === 0 ? 0 : round(((contestant.bidProfile.currentBid - previousBid) / previousBid) * 100, 2),
      tags: ["bid", contestant.advertiserId, duel.segment.category],
      metadata: {
        duelId: duel.duelId,
        previousBid,
        currentBid: contestant.bidProfile.currentBid,
        budgetRemaining: contestant.performance.budgetRemaining
      }
    });

    return contestant;
  }

  runRound(input: CampaignDuelRoundInput): DuelRound {
    const duel = this.requireDuel(input.duelId);
    if (duel.status === "pending") {
      this.activateDuel(duel.duelId, input.startedAt);
    }

    const startedAt = input.startedAt ?? new Date().toISOString();
    const endedAt = input.endedAt ?? startedAt;
    const heat = round(Math.max(input.heat ?? duel.segment.attentionScore, this.options.minimumHeat), 4);
    const audiencePressure = round(input.audiencePressure ?? duel.segment.categoryPressure, 4);
    const contestantsById = byContestantId(duel.contestants);

    const autopilotDecisions = duel.contestants
      .filter((contestant) => contestant.autopilotEnabled)
      .map((contestant) => this.buildAutopilotDecision(duel, contestant, startedAt, audiencePressure, heat));

    for (const decision of autopilotDecisions) {
      const contestant = contestantsById[this.findContestantIdByCampaign(duel, decision.campaignId)];
      if (contestant) {
        contestant.autopilotDecision = decision;
      }
    }

    const telemetryByContestant: Record<string, DuelRoundTelemetry> = {};
    const scoreByContestant: Record<string, number> = {};
    const alerts: CompetitorAlert[] = [];

    for (const contestant of duel.contestants) {
      const normalizedTelemetry = normalizeTelemetry(input.telemetryByContestant?.[contestant.contestantId]);
      telemetryByContestant[contestant.contestantId] = normalizedTelemetry;
      scoreByContestant[contestant.contestantId] = this.scoreContestant(duel, contestant, normalizedTelemetry, audiencePressure, heat);

      const competitorPool = this.buildCompetitorPool(duel, contestant, input.externalCompetitors?.[contestant.contestantId] ?? []);
      const evaluation = this.alertEngine.evaluate({
        segment: duel.segment,
        focusCampaign: contestant.performance,
        focusStreak: contestant.streak,
        focusBidProfile: contestant.bidProfile,
        autopilotDecision: contestant.autopilotDecision,
        competitors: competitorPool
      });
      alerts.push(...evaluation.alerts);
    }

    const orderedContestants = [...duel.contestants].sort((left, right) => scoreByContestant[right.contestantId] - scoreByContestant[left.contestantId]);
    const winningContestant = orderedContestants[0];
    const losingContestant = orderedContestants[1];
    const winningReason = this.chooseWinningReason(telemetryByContestant[winningContestant.contestantId], telemetryByContestant[losingContestant.contestantId], scoreByContestant[winningContestant.contestantId], scoreByContestant[losingContestant.contestantId]);

    const roundRecord: DuelRound = {
      roundId: randomUUID(),
      duelId: duel.duelId,
      status: "completed",
      startedAt,
      endedAt,
      audiencePressure,
      heat,
      scoreByContestant,
      telemetryByContestant,
      autopilotDecisions,
      alerts,
      winningContestantId: winningContestant.contestantId,
      winningReason
    };

    duel.rounds.push(roundRecord);
    duel.currentLeaderId = winningContestant.contestantId;
    duel.updatedAt = endedAt;
    duel.alertStream = [...duel.alertStream, ...alerts].slice(-this.options.maxEventHistory);

    this.applyTelemetryToPerformance(winningContestant, telemetryByContestant[winningContestant.contestantId], endedAt);
    this.applyTelemetryToPerformance(losingContestant, telemetryByContestant[losingContestant.contestantId], endedAt);

    this.recordEvent(duel.duelId, {
      category: "duel",
      ts: endedAt,
      headline: `${winningContestant.campaignName} won round ${duel.rounds.length}`,
      body: `${winningContestant.campaignName} outscored ${losingContestant.campaignName} ${round(scoreByContestant[winningContestant.contestantId], 2)} to ${round(scoreByContestant[losingContestant.contestantId], 2)} for ${duel.segment.segmentName}.`,
      segmentId: duel.segment.segmentId,
      segmentName: duel.segment.segmentName,
      actor: {
        advertiserId: winningContestant.advertiserId,
        campaignId: winningContestant.campaignId,
        displayName: winningContestant.campaignName
      },
      value: round(scoreByContestant[winningContestant.contestantId], 2),
      changePercent: round((scoreByContestant[winningContestant.contestantId] - scoreByContestant[losingContestant.contestantId]) / Math.max(scoreByContestant[losingContestant.contestantId], 1) * 100, 2),
      tags: ["duel", "round", winningReason ?? "higher-score", duel.segment.category],
      metadata: {
        duelId: duel.duelId,
        roundId: roundRecord.roundId,
        heat,
        audiencePressure,
        winnerContestantId: winningContestant.contestantId,
        loserContestantId: losingContestant.contestantId
      }
    });

    autopilotDecisions.forEach((decision) => {
      this.recordEvent(duel.duelId, {
        category: "autopilot",
        ts: decision.createdAt,
        headline: `Autopilot recalculated ${decision.campaignId}`,
        body: decision.trustMessage,
        segmentId: duel.segment.segmentId,
        segmentName: duel.segment.segmentName,
        value: decision.recommendedBid,
        changePercent: decision.percentChange,
        tags: ["autopilot", decision.advertiserId, duel.segment.category],
        metadata: {
          duelId: duel.duelId,
          campaignId: decision.campaignId,
          currentBid: decision.currentBid,
          recommendedBid: decision.recommendedBid,
          expectedLift: decision.expectedLift,
          expectedSavings: decision.expectedSavings
        }
      });
    });

    alerts.forEach((alert) => {
      this.recordEvent(duel.duelId, {
        category: "alert",
        ts: alert.createdAt,
        headline: alert.headline,
        body: alert.summary,
        severity: alert.severity,
        segmentId: alert.segmentId,
        segmentName: duel.segment.segmentName,
        tags: ["alert", alert.type, alert.category],
        metadata: {
          duelId: duel.duelId,
          alertId: alert.alertId,
          urgencyScore: alert.urgencyScore,
          recommendedAction: alert.recommendedAction
        }
      });
    });

    return roundRecord;
  }

  recordProfitDay(input: ProfitDayInput): RoiStreak {
    const duel = this.requireDuel(input.duelId);
    const contestant = this.requireContestant(duel, input.contestantId);
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const profitable = input.profit > 0;

    contestant.streak.profitableDays = profitable ? contestant.streak.profitableDays + 1 : 0;
    contestant.streak.longestProfitableDays = Math.max(contestant.streak.longestProfitableDays, contestant.streak.profitableDays);
    contestant.streak.consecutiveLossDays = profitable ? 0 : contestant.streak.consecutiveLossDays + 1;
    contestant.streak.lastProfitDate = profitable ? occurredAt : contestant.streak.lastProfitDate;
    contestant.streak.averageProfitPerDay = round(((contestant.streak.averageProfitPerDay * Math.max(contestant.streak.lastSevenDayRoas.length, 1)) + input.profit) / (Math.max(contestant.streak.lastSevenDayRoas.length, 1) + 1), 2);
    const roas = input.spend <= 0 ? (input.revenue > 0 ? input.revenue : 0) : input.revenue / input.spend;
    contestant.streak.currentRoas = round(roas, 2);
    contestant.streak.lastSevenDayRoas = [...contestant.streak.lastSevenDayRoas, round(roas, 2)].slice(-7);
    contestant.streak.statusLabel = createStatusLabel(contestant.streak);
    contestant.streak.momentum = contestant.streak.profitableDays >= 7
      ? "hot"
      : contestant.streak.profitableDays >= 3
        ? "warm"
        : contestant.streak.consecutiveLossDays >= 3
          ? "cooling"
          : "neutral";

    contestant.performance.roas = contestant.streak.currentRoas;
    contestant.performance.roi = input.spend > 0 ? round((input.revenue - input.spend) / input.spend, 4) : contestant.performance.roi;
    contestant.performance.updatedAt = occurredAt;
    duel.updatedAt = occurredAt;

    this.recordEvent(duel.duelId, {
      category: "roi",
      ts: occurredAt,
      headline: profitable
        ? `${contestant.campaignName} extended its streak to ${contestant.streak.profitableDays}`
        : `${contestant.campaignName} stumbled with a red day`,
      body: profitable
        ? `${contestant.campaignName} stayed profitable with ${contestant.streak.currentRoas}x ROAS.`
        : `${contestant.campaignName} now has ${contestant.streak.consecutiveLossDays} consecutive loss days.`,
      segmentId: duel.segment.segmentId,
      segmentName: duel.segment.segmentName,
      actor: {
        advertiserId: contestant.advertiserId,
        campaignId: contestant.campaignId,
        displayName: contestant.campaignName
      },
      value: contestant.streak.profitableDays,
      tags: ["roi", contestant.streak.momentum, duel.segment.category],
      metadata: {
        duelId: duel.duelId,
        profitable,
        currentRoas: contestant.streak.currentRoas,
        averageProfitPerDay: contestant.streak.averageProfitPerDay,
        statusLabel: contestant.streak.statusLabel
      }
    });

    return contestant.streak;
  }

  settleDuel(duelId: string, settledAt = new Date().toISOString()): DuelSettlement {
    const duel = this.requireDuel(duelId);
    const finalRound = duel.rounds[duel.rounds.length - 1];
    if (!finalRound || !finalRound.winningContestantId) {
      throw new Error(`Cannot settle duel ${duelId} without a completed round`);
    }

    const winner = this.requireContestant(duel, finalRound.winningContestantId);
    const loser = duel.contestants.find((contestant) => contestant.contestantId !== winner.contestantId);
    if (!loser) {
      throw new Error(`Unable to determine losing contestant for duel ${duelId}`);
    }

    const loserSpend = sum(duel.rounds.map((roundRecord) => roundRecord.telemetryByContestant[loser.contestantId]?.spend ?? 0));
    const refund = round(loserSpend * this.options.loserRefundShare, 2);
    const settlement: DuelSettlement = {
      settlementId: randomUUID(),
      duelId,
      winnerContestantId: winner.contestantId,
      loserContestantId: loser.contestantId,
      winnerVisibilityMultiplier: this.options.winnerVisibilityMultiplier,
      loserRefundAmount: refund,
      loserRefundReason: `${loser.campaignName} lost the duel and receives a spend protection credit.`,
      reason: finalRound.winningReason ?? "higher-score",
      settledAt
    };

    duel.status = "settled";
    duel.updatedAt = settledAt;
    duel.settlement = settlement;

    this.recordEvent(duelId, {
      category: "duel",
      ts: settledAt,
      headline: `${winner.campaignName} won the duel and doubled visibility`,
      body: `${loser.campaignName} receives ${formatCurrency(refund)} refund protection while ${winner.campaignName} earns ${this.options.winnerVisibilityMultiplier}x visibility.`,
      segmentId: duel.segment.segmentId,
      segmentName: duel.segment.segmentName,
      actor: {
        advertiserId: winner.advertiserId,
        campaignId: winner.campaignId,
        displayName: winner.campaignName
      },
      value: settlement.winnerVisibilityMultiplier,
      tags: ["duel", "settled", duel.segment.category],
      metadata: {
        duelId,
        settlementId: settlement.settlementId,
        loserRefundAmount: refund,
        winnerContestantId: winner.contestantId,
        loserContestantId: loser.contestantId
      }
    });

    return settlement;
  }

  getDuel(duelId: string): CampaignDuel | undefined {
    const duel = this.duelsById.get(duelId);
    if (!duel) {
      return undefined;
    }

    return this.cloneDuel(duel);
  }

  getTickerSnapshot(duelId: string): DuelTickerSnapshot {
    const duel = this.requireDuel(duelId);
    const latestRound = duel.rounds[duel.rounds.length - 1] ?? null;
    const events = [...(this.eventsByDuelId.get(duelId) ?? [])];
    return {
      duel: this.cloneDuel(duel),
      latestRound,
      events
    };
  }

  listDuels(): CampaignDuel[] {
    return [...this.duelsById.values()].map((duel) => this.cloneDuel(duel));
  }

  getPortfolioSummary(): DuelPortfolioSummary {
    const duels = [...this.duelsById.values()];
    const allContestants = duels.flatMap((duel) => duel.contestants);
    const activeDuels = duels.filter((duel) => duel.status === "active").length;
    const settledDuels = duels.filter((duel) => duel.status === "settled").length;
    const totalRefundExposure = round(sum(duels.map((duel) => duel.settlement?.loserRefundAmount ?? 0)), 2);
    const totalBidVolume = round(sum(allContestants.map((contestant) => contestant.bidProfile.currentBid)), 2);
    const hottestDuel = [...duels].sort((left, right) => right.segment.attentionScore - left.segment.attentionScore)[0];
    const autopilotEnabledContestants = allContestants.filter((contestant) => contestant.autopilotEnabled).length;
    const activeAlerts = duels.reduce((total, duel) => total + duel.alertStream.filter((alert) => alert.status !== "resolved").length, 0);

    return {
      activeDuels,
      settledDuels,
      totalRefundExposure,
      totalBidVolume,
      hottestSegment: hottestDuel?.segment.segmentName ?? null,
      autopilotEnabledContestants,
      activeAlerts
    };
  }

  private createContestant(seed: DuelContestantSeed, createdAt: string): DuelContestant {
    const streak = this.createStreak(seed, createdAt);

    return {
      contestantId: randomUUID(),
      advertiserId: seed.advertiserId,
      campaignId: seed.campaignId,
      campaignName: seed.campaignName,
      bidProfile: {
        ...seed.bidProfile,
        currentBid: round(seed.bidProfile.currentBid, 2),
        maxBid: round(seed.bidProfile.maxBid, 2),
        minBid: round(seed.bidProfile.minBid, 2),
        budgetRemaining: round(seed.bidProfile.budgetRemaining, 2)
      },
      performance: {
        ...seed.performance,
        updatedAt: seed.performance.updatedAt ?? createdAt,
        launchTs: seed.performance.launchTs ?? createdAt,
        bid: round(seed.performance.bid, 2),
        targetBid: round(seed.performance.targetBid, 2),
        budgetRemaining: round(seed.performance.budgetRemaining, 2),
        dailyBudget: round(seed.performance.dailyBudget, 2),
        spendToday: round(seed.performance.spendToday, 2),
        roi: round(seed.performance.roi, 4),
        roas: round(seed.performance.roas, 4)
      },
      autopilotEnabled: seed.autopilotEnabled ?? true,
      streak
    };
  }

  private createStreak(seed: DuelContestantSeed, createdAt: string): RoiStreak {
    const baseStreak: RoiStreak = {
      campaignId: seed.campaignId,
      advertiserId: seed.advertiserId,
      profitableDays: seed.streak?.profitableDays ?? (seed.performance.roas >= seed.performance.targetRoas ? 1 : 0),
      longestProfitableDays: seed.streak?.longestProfitableDays ?? (seed.performance.roas >= seed.performance.targetRoas ? 1 : 0),
      lastProfitDate: seed.streak?.lastProfitDate ?? createdAt,
      currentRoas: seed.streak?.currentRoas ?? round(seed.performance.roas, 2),
      targetRoas: seed.streak?.targetRoas ?? round(seed.performance.targetRoas, 2),
      consecutiveLossDays: seed.streak?.consecutiveLossDays ?? (seed.performance.roas >= seed.performance.targetRoas ? 0 : 1),
      averageProfitPerDay: seed.streak?.averageProfitPerDay ?? round(seed.performance.revenue - seed.performance.spendToday, 2),
      lastSevenDayRoas: seed.streak?.lastSevenDayRoas ?? [round(seed.performance.roas, 2)],
      statusLabel: seed.streak?.statusLabel ?? "warming up",
      momentum: seed.streak?.momentum ?? (seed.performance.roas >= seed.performance.targetRoas ? "warm" : "neutral")
    };

    baseStreak.statusLabel = createStatusLabel(baseStreak);
    return baseStreak;
  }

  private buildAutopilotDecision(
    duel: CampaignDuel,
    contestant: DuelContestant,
    startedAt: string,
    audiencePressure: number,
    heat: number
  ): BidAutopilotDecision {
    const bidResult = this.biddingEngine.calculateOutcomeBid({
      baseOutcomePrice: contestant.bidProfile.baseOutcomePrice,
      audience: {
        verifiedLtv: duel.segment.verifiedLtv,
        intentScore: clamp((duel.segment.attentionScore + contestant.performance.attentionScore) / 2, 0, 1),
        conversionRate: clamp((duel.segment.conversionRate + contestant.bidProfile.conversionRate + contestant.performance.conversions / Math.max(contestant.performance.impressions, 1)) / 3, 0, 1),
        recencyMultiplier: contestant.bidProfile.recencyMultiplier ?? 1
      },
      marketPressure: clamp(audiencePressure * heat, 0.8, 1.5),
      floorPrice: contestant.bidProfile.minBid,
      maxPrice: contestant.bidProfile.maxBid,
      riskTolerance: clamp(1 - contestant.performance.roas / Math.max(contestant.performance.targetRoas + 0.01, 0.01), 0, 1)
    });

    const targetBid = round(clamp(
      bidResult.finalBid * (duel.segment.attentionScore > contestant.performance.attentionScore ? 1.05 : 0.98),
      contestant.bidProfile.minBid,
      contestant.bidProfile.maxBid
    ), 2);
    const delta = round(targetBid - contestant.bidProfile.currentBid, 2);
    const percentChange = contestant.bidProfile.currentBid === 0 ? 0 : round((delta / contestant.bidProfile.currentBid) * 100, 2);
    const expectedLift = round(Math.max(duel.segment.attentionScore - contestant.performance.attentionScore, 0) * 100 + Math.max(audiencePressure - 1, 0) * 25 + heat * 8, 2);
    const expectedSavings = delta <= 0
      ? round(Math.abs(delta) * duel.segment.impressionsPerMinute * 0.2, 2)
      : round(Math.max(contestant.performance.roas - contestant.performance.targetRoas, 0) * 18 + (contestant.performance.shareOfVoice - duel.segment.winningBid / Math.max(targetBid, 0.01)) * 12, 2);
    const realizedConversionRate = contestant.performance.impressions > 0
      ? contestant.performance.conversions / contestant.performance.impressions
      : contestant.bidProfile.conversionRate;
    const confidence = round(clamp(0.55 + duel.segment.attentionScore * 0.2 + realizedConversionRate * 0.25 + heat * 0.05, 0, 1), 3);
    const riskScore = round(clamp(1 - contestant.performance.roas / Math.max(contestant.performance.targetRoas, 0.01), 0, 1), 3);
    const executeBy = new Date(Date.parse(startedAt) + this.options.autopilotLookaheadMinutes * 60_000).toISOString();

    const rationale = [
      `Segment attention is ${round(duel.segment.attentionScore * 100, 2)}%.`,
      `Current market pressure sits at ${round(audiencePressure, 2)}x.`,
      `Campaign ROAS is ${round(contestant.performance.roas, 2)}x versus ${round(contestant.performance.targetRoas, 2)}x target.`,
      `Current bid ${formatCurrency(contestant.bidProfile.currentBid)} maps to BiddingEngine output ${formatCurrency(bidResult.finalBid)}.`
    ];

    const trustMessage = delta > 0
      ? `Our AI wants to raise ${contestant.campaignName} by ${round(percentChange, 2)}% before peak attention closes, projecting ${expectedLift}% lift while keeping risk at ${round(riskScore * 100, 2)}%.`
      : `Our AI can save ${formatCurrency(expectedSavings)} by trimming ${contestant.campaignName} to ${formatCurrency(targetBid)} while the campaign still outranks the floor.`;

    return {
      decisionId: randomUUID(),
      campaignId: contestant.campaignId,
      advertiserId: contestant.advertiserId,
      segmentId: duel.segment.segmentId,
      currentBid: contestant.bidProfile.currentBid,
      recommendedBid: targetBid,
      percentChange,
      confidence,
      expectedLift,
      expectedSavings,
      riskScore,
      rationale,
      trustMessage,
      executeBy,
      createdAt: startedAt
    };
  }

  private buildCompetitorPool(
    duel: CampaignDuel,
    contestant: DuelContestant,
    externalCompetitors: CompetitorSnapshot[]
  ): CompetitorSnapshot[] {
    const mirroredContestants = duel.contestants
      .filter((candidate) => candidate.contestantId !== contestant.contestantId)
      .map((candidate) => ({
        advertiserId: candidate.advertiserId,
        campaignId: candidate.campaignId,
        campaignName: candidate.campaignName,
        category: candidate.performance.category,
        segmentId: duel.segment.segmentId,
        region: duel.segment.region,
        budgetRemaining: candidate.performance.budgetRemaining,
        dailyBudget: candidate.performance.dailyBudget,
        currentBid: candidate.bidProfile.currentBid,
        shareOfVoice: candidate.performance.shareOfVoice,
        attentionScore: candidate.performance.attentionScore,
        roi: candidate.performance.roi,
        roas: candidate.performance.roas,
        growthRate: clamp(candidate.performance.conversions / Math.max(candidate.performance.impressions, 1), 0, 1),
        launchedAt: candidate.performance.launchTs,
        updatedAt: candidate.performance.updatedAt
      }));

    return [...mirroredContestants, ...externalCompetitors];
  }

  private scoreContestant(
    duel: CampaignDuel,
    contestant: DuelContestant,
    telemetry: DuelRoundTelemetry,
    audiencePressure: number,
    heat: number
  ): number {
    const autopilotBoost = contestant.autopilotDecision ? contestant.autopilotDecision.confidence * 6 : 0;
    const streakBoost = contestant.streak.profitableDays * 0.65;
    const roiWeight = Math.max(contestant.performance.roi, 0) * 16;
    const shareWeight = telemetry.shareOfVoice * 24;
    const attentionWeight = telemetry.attentionCapture * 28;
    const conversionWeight = telemetry.conversions * 9;
    const reactionPenalty = clamp(telemetry.reactionLatencyMs / 500, 0, 6);
    const bidPressure = contestant.bidProfile.currentBid * 2.6;
    const marketAmplifier = audiencePressure * heat * 4;
    const budgetGuardrail = contestant.performance.budgetRemaining <= contestant.performance.dailyBudget * 0.08 ? -6 : 0;
    const floorPenalty = contestant.bidProfile.currentBid < duel.segment.floorBid ? -10 : 0;

    return round(
      bidPressure +
      attentionWeight +
      shareWeight +
      conversionWeight +
      roiWeight +
      autopilotBoost +
      streakBoost +
      marketAmplifier +
      budgetGuardrail +
      floorPenalty -
      reactionPenalty,
      4
    );
  }

  private chooseWinningReason(
    winnerTelemetry: DuelRoundTelemetry,
    loserTelemetry: DuelRoundTelemetry,
    winnerScore: number,
    loserScore: number
  ): DuelRound["winningReason"] {
    if (winnerTelemetry.attentionCapture - loserTelemetry.attentionCapture >= 0.1) {
      return "attention-dominance";
    }
    const winnerRoas = summarizeRoi(winnerTelemetry.revenue, winnerTelemetry.spend).roas;
    const loserRoas = summarizeRoi(loserTelemetry.revenue, loserTelemetry.spend).roas;
    if (winnerRoas > loserRoas) {
      return "roi-superiority";
    }
    if (loserTelemetry.spend > 0 && winnerTelemetry.spend === 0) {
      return "opponent-budget-exhausted";
    }
    if (Math.abs(winnerScore - loserScore) < 3) {
      return "tie-breaker";
    }
    return "higher-score";
  }

  private applyTelemetryToPerformance(
    contestant: DuelContestant,
    telemetry: DuelRoundTelemetry,
    updatedAt: string
  ): void {
    contestant.performance.impressions += telemetry.impressionsWon;
    contestant.performance.conversions += telemetry.conversions;
    contestant.performance.outcomes += telemetry.conversions;
    contestant.performance.spendToday = round(contestant.performance.spendToday + telemetry.spend, 2);
    contestant.performance.revenue = round(contestant.performance.revenue + telemetry.revenue, 2);
    contestant.performance.budgetRemaining = round(Math.max(contestant.performance.budgetRemaining - telemetry.spend, 0), 2);
    contestant.bidProfile.budgetRemaining = contestant.performance.budgetRemaining;
    contestant.performance.attentionScore = round(clamp((contestant.performance.attentionScore + telemetry.attentionCapture) / 2, 0, 1), 4);
    contestant.performance.shareOfVoice = round(clamp(telemetry.shareOfVoice || contestant.performance.shareOfVoice, 0, 1), 4);
    const roi = summarizeRoi(contestant.performance.revenue, contestant.performance.spendToday);
    contestant.performance.roi = roi.roi;
    contestant.performance.roas = roi.roas;
    contestant.performance.averageOutcomeCost = contestant.performance.outcomes > 0
      ? round(contestant.performance.spendToday / contestant.performance.outcomes, 2)
      : contestant.performance.averageOutcomeCost;
    contestant.performance.updatedAt = updatedAt;
  }

  private recordEvent(duelId: string, event: Omit<TickerEvent, "eventId">): void {
    const history = this.eventsByDuelId.get(duelId) ?? [];
    pushBounded(history, { eventId: randomUUID(), ...event }, this.options.maxEventHistory);
    this.eventsByDuelId.set(duelId, history);
  }

  private requireDuel(duelId: string): CampaignDuel {
    const duel = this.duelsById.get(duelId);
    if (!duel) {
      throw new Error(`Unknown duel ${duelId}`);
    }
    return duel;
  }

  private requireContestant(duel: CampaignDuel, contestantId: string): DuelContestant {
    const contestant = duel.contestants.find((candidate) => candidate.contestantId === contestantId);
    if (!contestant) {
      throw new Error(`Unknown contestant ${contestantId} for duel ${duel.duelId}`);
    }
    return contestant;
  }

  private findContestantIdByCampaign(duel: CampaignDuel, campaignId: string): string {
    const contestant = duel.contestants.find((candidate) => candidate.campaignId === campaignId);
    if (!contestant) {
      throw new Error(`Unknown campaign ${campaignId} for duel ${duel.duelId}`);
    }
    return contestant.contestantId;
  }

  private cloneDuel(duel: CampaignDuel): CampaignDuel {
    return JSON.parse(JSON.stringify(duel)) as CampaignDuel;
  }
}
