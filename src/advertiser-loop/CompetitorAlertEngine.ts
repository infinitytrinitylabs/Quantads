import { randomUUID } from "node:crypto";
import {
  CampaignBidProfile,
  CampaignPerformanceSnapshot,
  CompetitorAlert,
  CompetitorAlertContext,
  CompetitorAlertEvaluation,
  CompetitorSnapshot,
  RoiStreak,
  AlertSeverity,
  AlertType,
  average,
  clamp,
  createMomentum,
  formatCurrency,
  getHighestSeverity,
  round,
  severityWeight,
  uniqueBy
} from "./models";

export interface CompetitorAlertEngineOptions {
  cooldownMinutes: number;
  budgetDefenseRatio: number;
  shareOfVoiceCriticalGap: number;
  shareOfVoiceWarningGap: number;
  attentionSpikeThreshold: number;
  attentionDropThreshold: number;
  roiStreakRiskDays: number;
  alertTtlMinutes: number;
}

const DEFAULT_OPTIONS: CompetitorAlertEngineOptions = {
  cooldownMinutes: 15,
  budgetDefenseRatio: 1.8,
  shareOfVoiceCriticalGap: 0.18,
  shareOfVoiceWarningGap: 0.08,
  attentionSpikeThreshold: 0.12,
  attentionDropThreshold: 0.1,
  roiStreakRiskDays: 2,
  alertTtlMinutes: 45
};

interface AlertSignal {
  type: AlertType;
  severity: AlertSeverity;
  headline: string;
  summary: string;
  recommendedAction: string;
  deltaValue: number;
  deltaPercent: number;
  urgencyScore: number;
  metadata: Record<string, string | number | boolean | null>;
}

const sumWeights = (alerts: CompetitorAlert[]): number => {
  return alerts.reduce((score, alert) => score + severityWeight(alert.severity), 0);
};

const roundPercent = (value: number): number => round(value * 100, 2);

const normalizePercentDelta = (current: number, baseline: number): number => {
  if (baseline === 0) {
    return current === 0 ? 0 : 100;
  }

  return round(((current - baseline) / baseline) * 100, 2);
};

const urgencyFromSeverity = (severity: AlertSeverity, deltaPercent: number, modifier = 0): number => {
  const base = severity === "critical" ? 0.8 : severity === "warning" ? 0.58 : 0.32;
  return clamp(round(base + Math.abs(deltaPercent) / 250 + modifier, 3), 0, 1);
};

export class CompetitorAlertEngine {
  private readonly options: CompetitorAlertEngineOptions;
  private readonly alertRegistry = new Map<string, CompetitorAlert>();

  constructor(options: Partial<CompetitorAlertEngineOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  evaluate(context: CompetitorAlertContext): CompetitorAlertEvaluation {
    const signals: AlertSignal[] = [];
    const averageCompetitorBid = average(context.competitors.map((competitor) => competitor.currentBid));
    const shareOfVoiceGap = round(average(context.competitors.map((competitor) => competitor.shareOfVoice)) - context.focusCampaign.shareOfVoice, 4);

    signals.push(...this.analyzeBudgetPressure(context.focusCampaign, context.competitors));
    signals.push(...this.analyzeRankAndShare(context.focusCampaign, context.competitors));
    signals.push(...this.analyzeAttention(context.focusCampaign, context.competitors));
    signals.push(...this.analyzeRoiStreak(context.focusCampaign, context.focusStreak));
    signals.push(...this.analyzeAutopilot(context.focusCampaign, context.focusBidProfile, context.autopilotDecision, averageCompetitorBid));
    signals.push(...this.analyzeAudienceShift(context.focusCampaign, context.competitors, context.segment.categoryPressure));

    const alerts = uniqueBy(
      signals.map((signal) => this.materializeAlert(context, signal)),
      (alert) => `${alert.type}:${alert.headline}`
    ).map((alert) => this.reconcileCooldown(alert));

    return {
      alerts,
      highestSeverity: getHighestSeverity(alerts),
      recommendedBidFloor: this.deriveRecommendedBidFloor(context.focusBidProfile, averageCompetitorBid, alerts),
      averageCompetitorBid: round(averageCompetitorBid, 2),
      shareOfVoiceGap: round(shareOfVoiceGap, 4)
    };
  }

  resolveAlert(alertId: string): CompetitorAlert | undefined {
    const alert = this.alertRegistry.get(alertId);
    if (!alert) {
      return undefined;
    }

    const resolved = {
      ...alert,
      status: "resolved" as const
    };

    this.alertRegistry.set(alertId, resolved);
    return resolved;
  }

  listActiveAlerts(advertiserId?: string): CompetitorAlert[] {
    const now = Date.now();

    return [...this.alertRegistry.values()]
      .filter((alert) => (advertiserId ? alert.advertiserId === advertiserId : true))
      .filter((alert) => alert.status !== "resolved")
      .filter((alert) => Date.parse(alert.expiresAt) > now)
      .sort((left, right) => right.urgencyScore - left.urgencyScore || Date.parse(right.createdAt) - Date.parse(left.createdAt));
  }

  summarize(alerts: CompetitorAlert[]): {
    total: number;
    critical: number;
    warning: number;
    info: number;
    aggregateUrgency: number;
    defenseAlerts: number;
  } {
    return alerts.reduce(
      (summary, alert) => {
        if (alert.severity === "critical") {
          summary.critical += 1;
        } else if (alert.severity === "warning") {
          summary.warning += 1;
        } else {
          summary.info += 1;
        }

        if (alert.type === "budget-defense" || alert.type === "rank-loss") {
          summary.defenseAlerts += 1;
        }

        summary.total += 1;
        summary.aggregateUrgency = round(summary.aggregateUrgency + alert.urgencyScore, 3);
        return summary;
      },
      {
        total: 0,
        critical: 0,
        warning: 0,
        info: 0,
        aggregateUrgency: 0,
        defenseAlerts: 0
      }
    );
  }

  private analyzeBudgetPressure(
    focusCampaign: CampaignPerformanceSnapshot,
    competitors: CompetitorSnapshot[]
  ): AlertSignal[] {
    if (!competitors.length) {
      return [];
    }

    const topBudget = competitors.reduce((leader, competitor) => {
      return competitor.dailyBudget > leader.dailyBudget ? competitor : leader;
    }, competitors[0]);

    const ratio = focusCampaign.dailyBudget === 0 ? 0 : topBudget.dailyBudget / focusCampaign.dailyBudget;
    const deltaPercent = normalizePercentDelta(topBudget.dailyBudget, focusCampaign.dailyBudget);
    const shouldDefend = ratio >= this.options.budgetDefenseRatio;

    if (!shouldDefend) {
      return [];
    }

    return [
      {
        type: "budget-defense",
        severity: ratio >= this.options.budgetDefenseRatio * 1.3 ? "critical" : "warning",
        headline: `${topBudget.campaignName} just armed ${round(ratio, 2)}x more daily budget`,
        summary: `A competitor now has ${formatCurrency(topBudget.dailyBudget)} daily firepower versus your ${formatCurrency(focusCampaign.dailyBudget)}.` ,
        recommendedAction: "Increase defensive budget or let autopilot protect your highest-attention inventory.",
        deltaValue: round(topBudget.dailyBudget - focusCampaign.dailyBudget, 2),
        deltaPercent,
        urgencyScore: urgencyFromSeverity(ratio >= this.options.budgetDefenseRatio * 1.3 ? "critical" : "warning", deltaPercent, 0.12),
        metadata: {
          competitorCampaignId: topBudget.campaignId,
          competitorAdvertiserId: topBudget.advertiserId,
          competitorDailyBudget: topBudget.dailyBudget,
          focusDailyBudget: focusCampaign.dailyBudget,
          ratio: round(ratio, 3)
        }
      }
    ];
  }

  private analyzeRankAndShare(
    focusCampaign: CampaignPerformanceSnapshot,
    competitors: CompetitorSnapshot[]
  ): AlertSignal[] {
    const richerShare = competitors.filter((competitor) => competitor.shareOfVoice > focusCampaign.shareOfVoice);
    if (!richerShare.length) {
      return [
        {
          type: "rank-gain",
          severity: "info",
          headline: `${focusCampaign.campaignId} is defending the top share of voice`,
          summary: `Your campaign is ahead of every active competitor with ${roundPercent(focusCampaign.shareOfVoice)}% share of voice.`,
          recommendedAction: "Hold current position or let autopilot trim bids for efficient profit capture.",
          deltaValue: 0,
          deltaPercent: 0,
          urgencyScore: 0.22,
          metadata: {
            focusShareOfVoice: focusCampaign.shareOfVoice,
            competitorCount: competitors.length
          }
        }
      ];
    }

    const leadingCompetitor = richerShare.reduce((leader, competitor) => {
      return competitor.shareOfVoice > leader.shareOfVoice ? competitor : leader;
    }, richerShare[0]);
    const gap = leadingCompetitor.shareOfVoice - focusCampaign.shareOfVoice;
    const severity: AlertSeverity = gap >= this.options.shareOfVoiceCriticalGap ? "critical" : gap >= this.options.shareOfVoiceWarningGap ? "warning" : "info";

    return [
      {
        type: "rank-loss",
        severity,
        headline: `${leadingCompetitor.campaignName} now owns the louder voice`,
        summary: `You trail by ${roundPercent(gap)} share-of-voice points in your core audience.` ,
        recommendedAction: severity === "critical"
          ? "Defend immediately with a bid lift or reallocate budget before awareness compounds against you."
          : "Consider a measured bid increase to recover impression dominance.",
        deltaValue: round(gap, 4),
        deltaPercent: roundPercent(gap),
        urgencyScore: urgencyFromSeverity(severity, roundPercent(gap), 0.08),
        metadata: {
          competitorCampaignId: leadingCompetitor.campaignId,
          competitorShareOfVoice: leadingCompetitor.shareOfVoice,
          focusShareOfVoice: focusCampaign.shareOfVoice,
          focusBid: focusCampaign.bid,
          competitorBid: leadingCompetitor.currentBid
        }
      }
    ];
  }

  private analyzeAttention(
    focusCampaign: CampaignPerformanceSnapshot,
    competitors: CompetitorSnapshot[]
  ): AlertSignal[] {
    if (!competitors.length) {
      return [];
    }

    const hottestCompetitor = competitors.reduce((leader, competitor) => {
      return competitor.attentionScore > leader.attentionScore ? competitor : leader;
    }, competitors[0]);

    const momentum = createMomentum(hottestCompetitor.attentionScore, focusCampaign.attentionScore);
    const growthLeader = competitors.reduce((leader, competitor) => {
      return competitor.growthRate > leader.growthRate ? competitor : leader;
    }, competitors[0]);

    const alerts: AlertSignal[] = [];

    if (momentum.delta >= this.options.attentionSpikeThreshold) {
      alerts.push({
        type: "attention-surge",
        severity: momentum.delta >= this.options.attentionSpikeThreshold * 1.8 ? "critical" : "warning",
        headline: `${hottestCompetitor.campaignName} is siphoning focus`,
        summary: `Competitor attention is up ${momentum.deltaPercent}% versus your current ${roundPercent(focusCampaign.attentionScore)}% score.`,
        recommendedAction: "Pivot creative or let autopilot chase the new attention pocket during the next refresh.",
        deltaValue: round(momentum.delta, 4),
        deltaPercent: momentum.deltaPercent,
        urgencyScore: urgencyFromSeverity(momentum.delta >= this.options.attentionSpikeThreshold * 1.8 ? "critical" : "warning", momentum.deltaPercent, 0.1),
        metadata: {
          competitorCampaignId: hottestCompetitor.campaignId,
          competitorAttentionScore: hottestCompetitor.attentionScore,
          focusAttentionScore: focusCampaign.attentionScore
        }
      });
    }

    if (focusCampaign.attentionScore - hottestCompetitor.attentionScore >= this.options.attentionDropThreshold) {
      alerts.push({
        type: "duel-win-window",
        severity: "info",
        headline: `You have an attention window over ${hottestCompetitor.campaignName}`,
        summary: `Your attention score leads by ${roundPercent(focusCampaign.attentionScore - hottestCompetitor.attentionScore)} points.`,
        recommendedAction: "Lock in efficient conversions while your creative is still winning the eye-tracking battle.",
        deltaValue: round(focusCampaign.attentionScore - hottestCompetitor.attentionScore, 4),
        deltaPercent: roundPercent(focusCampaign.attentionScore - hottestCompetitor.attentionScore),
        urgencyScore: 0.28,
        metadata: {
          competitorCampaignId: hottestCompetitor.campaignId,
          growthLeaderCampaignId: growthLeader.campaignId,
          growthRate: growthLeader.growthRate
        }
      });
    }

    return alerts;
  }

  private analyzeRoiStreak(
    focusCampaign: CampaignPerformanceSnapshot,
    streak: RoiStreak
  ): AlertSignal[] {
    const alerts: AlertSignal[] = [];
    const shortfall = streak.targetRoas - focusCampaign.roas;

    if (streak.profitableDays >= 3) {
      alerts.push({
        type: "roi-streak",
        severity: streak.profitableDays >= 10 ? "warning" : "info",
        headline: `${streak.profitableDays}-day ROI streak is alive`,
        summary: `Your campaign has stayed profitable for ${streak.profitableDays} consecutive days with ${round(focusCampaign.roas, 2)}x ROAS.`,
        recommendedAction: streak.profitableDays >= 10
          ? "Press your advantage with autopilot guardrails before competitors notice the streak."
          : "Celebrate the streak, then keep creative freshness high to extend it.",
        deltaValue: round(streak.profitableDays, 2),
        deltaPercent: roundPercent(Math.min(streak.profitableDays / Math.max(streak.longestProfitableDays, 1), 1)),
        urgencyScore: 0.24,
        metadata: {
          profitableDays: streak.profitableDays,
          longestProfitableDays: streak.longestProfitableDays,
          targetRoas: streak.targetRoas,
          currentRoas: focusCampaign.roas
        }
      });
    }

    if (shortfall > 0 && streak.consecutiveLossDays >= this.options.roiStreakRiskDays) {
      alerts.push({
        type: "roi-streak-risk",
        severity: streak.consecutiveLossDays >= this.options.roiStreakRiskDays + 2 ? "critical" : "warning",
        headline: `ROI streak is at risk after ${streak.consecutiveLossDays} red days`,
        summary: `ROAS is trailing target by ${round(shortfall, 2)} and the portfolio is cooling off.`,
        recommendedAction: "Cut waste now, tighten audience scope, or let autopilot defend only the highest-margin impressions.",
        deltaValue: round(shortfall, 2),
        deltaPercent: normalizePercentDelta(focusCampaign.roas, streak.targetRoas),
        urgencyScore: urgencyFromSeverity(streak.consecutiveLossDays >= this.options.roiStreakRiskDays + 2 ? "critical" : "warning", shortfall * 100, 0.1),
        metadata: {
          targetRoas: streak.targetRoas,
          currentRoas: focusCampaign.roas,
          consecutiveLossDays: streak.consecutiveLossDays,
          profitableDays: streak.profitableDays
        }
      });
    }

    return alerts;
  }

  private analyzeAutopilot(
    focusCampaign: CampaignPerformanceSnapshot,
    bidProfile: CampaignBidProfile,
    autopilotDecision: CompetitorAlertContext["autopilotDecision"],
    averageCompetitorBid: number
  ): AlertSignal[] {
    const signals: AlertSignal[] = [];
    const bidGap = averageCompetitorBid - focusCampaign.bid;

    if (autopilotDecision && autopilotDecision.percentChange > 0) {
      signals.push({
        type: "autopilot-opportunity",
        severity: autopilotDecision.percentChange >= 18 ? "warning" : "info",
        headline: `Autopilot wants ${round(autopilotDecision.percentChange, 2)}% more bid pressure`,
        summary: `AI modeled ${round(autopilotDecision.expectedLift, 2)}% lift and ${formatCurrency(autopilotDecision.expectedSavings)} in protected savings if it steers the bid.`,
        recommendedAction: `Raise bid toward ${formatCurrency(autopilotDecision.recommendedBid)} before ${autopilotDecision.executeBy}.`,
        deltaValue: round(autopilotDecision.recommendedBid - autopilotDecision.currentBid, 2),
        deltaPercent: round(autopilotDecision.percentChange, 2),
        urgencyScore: urgencyFromSeverity(autopilotDecision.percentChange >= 18 ? "warning" : "info", autopilotDecision.percentChange, 0.03),
        metadata: {
          currentBid: autopilotDecision.currentBid,
          recommendedBid: autopilotDecision.recommendedBid,
          expectedLift: autopilotDecision.expectedLift,
          expectedSavings: autopilotDecision.expectedSavings,
          confidence: autopilotDecision.confidence
        }
      });
    }

    if (bidGap < 0 && focusCampaign.roas > bidProfile.targetRoas) {
      signals.push({
        type: "autopilot-savings",
        severity: "info",
        headline: `Autopilot sees room to save without losing rank`,
        summary: `Your ${formatCurrency(focusCampaign.bid)} bid already clears the market by ${formatCurrency(Math.abs(bidGap))}.`,
        recommendedAction: "Trim bid gently and bank efficiency while keeping the duel lead.",
        deltaValue: round(Math.abs(bidGap), 2),
        deltaPercent: round(Math.abs(bidGap / Math.max(focusCampaign.bid, 0.01)) * 100, 2),
        urgencyScore: 0.2,
        metadata: {
          currentBid: focusCampaign.bid,
          averageCompetitorBid,
          targetRoas: bidProfile.targetRoas,
          currentRoas: focusCampaign.roas
        }
      });
    }

    return signals;
  }

  private analyzeAudienceShift(
    focusCampaign: CampaignPerformanceSnapshot,
    competitors: CompetitorSnapshot[],
    categoryPressure: number
  ): AlertSignal[] {
    if (!competitors.length) {
      return [];
    }

    const meanGrowth = average(competitors.map((competitor) => competitor.growthRate));
    const pressureModifier = clamp(categoryPressure - 1, 0, 1);

    if (meanGrowth + pressureModifier < 0.12) {
      return [];
    }

    const severity: AlertSeverity = meanGrowth + pressureModifier > 0.24 ? "warning" : "info";

    return [
      {
        type: "audience-shift",
        severity,
        headline: `Audience demand is migrating faster than usual`,
        summary: `Category pressure is ${round(categoryPressure, 2)}x and competitors are growing share at ${round(meanGrowth * 100, 2)}% pace.`,
        recommendedAction: "Refresh messaging or reweight bids toward the fastest-growing sub-segment before attention pools elsewhere.",
        deltaValue: round(meanGrowth + pressureModifier, 3),
        deltaPercent: round((meanGrowth + pressureModifier) * 100, 2),
        urgencyScore: urgencyFromSeverity(severity, (meanGrowth + pressureModifier) * 100, 0.04),
        metadata: {
          categoryPressure: round(categoryPressure, 2),
          averageCompetitorGrowthRate: round(meanGrowth, 4),
          focusCampaignId: focusCampaign.campaignId
        }
      }
    ];
  }

  private materializeAlert(context: CompetitorAlertContext, signal: AlertSignal): CompetitorAlert {
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + this.options.alertTtlMinutes * 60_000).toISOString();

    return {
      alertId: randomUUID(),
      advertiserId: context.focusCampaign.advertiserId,
      campaignId: context.focusCampaign.campaignId,
      segmentId: context.segment.segmentId,
      category: context.segment.category,
      type: signal.type,
      severity: signal.severity,
      status: "active",
      headline: signal.headline,
      summary: signal.summary,
      recommendedAction: signal.recommendedAction,
      deltaValue: signal.deltaValue,
      deltaPercent: signal.deltaPercent,
      urgencyScore: signal.urgencyScore,
      createdAt,
      expiresAt,
      metadata: {
        ...signal.metadata,
        segmentName: context.segment.segmentName,
        region: context.segment.region,
        categoryPressure: context.segment.categoryPressure,
        focusCampaignRoas: context.focusCampaign.roas,
        focusCampaignBid: context.focusCampaign.bid,
        focusCampaignAttentionScore: context.focusCampaign.attentionScore
      }
    };
  }

  private reconcileCooldown(alert: CompetitorAlert): CompetitorAlert {
    const key = `${alert.advertiserId}:${alert.campaignId}:${alert.segmentId}:${alert.type}`;
    const existing = this.alertRegistry.get(key);

    if (!existing) {
      this.alertRegistry.set(key, alert);
      return alert;
    }

    const ageMs = Date.parse(alert.createdAt) - Date.parse(existing.createdAt);
    if (ageMs < this.options.cooldownMinutes * 60_000 && existing.status !== "resolved") {
      const cooled: CompetitorAlert = {
        ...alert,
        alertId: existing.alertId,
        createdAt: existing.createdAt,
        status: "cooldown"
      };
      this.alertRegistry.set(key, cooled);
      return cooled;
    }

    this.alertRegistry.set(key, alert);
    return alert;
  }

  private deriveRecommendedBidFloor(
    bidProfile: CampaignBidProfile,
    averageCompetitorBid: number,
    alerts: CompetitorAlert[]
  ): number {
    const criticalBudgetDefense = alerts.some((alert) => alert.type === "budget-defense" && alert.severity === "critical");
    const rankLoss = alerts.some((alert) => alert.type === "rank-loss");
    const weightedSignal = sumWeights(alerts);
    const baseline = Math.max(bidProfile.currentBid, averageCompetitorBid || bidProfile.currentBid);
    const multiplier = 1 + (criticalBudgetDefense ? 0.16 : 0) + (rankLoss ? 0.07 : 0) + weightedSignal * 0.01;
    return round(clamp(baseline * multiplier, bidProfile.minBid, bidProfile.maxBid), 2);
  }
}
