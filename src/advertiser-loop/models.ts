export type CurrencyCode = "USD" | "USDC" | "USDT" | "DAI" | "ETH" | "WETH" | "BTC" | "WBTC";

export type AlertSeverity = "info" | "warning" | "critical";
export type AlertStatus = "active" | "cooldown" | "resolved";
export type AlertType =
  | "budget-overrun"
  | "budget-defense"
  | "rank-loss"
  | "rank-gain"
  | "attention-surge"
  | "attention-drop"
  | "duel-threat"
  | "duel-win-window"
  | "roi-streak"
  | "roi-streak-risk"
  | "autopilot-opportunity"
  | "autopilot-savings"
  | "audience-shift"
  | "share-of-voice"
  | "refund-protection";

export type DuelStatus = "pending" | "active" | "cooldown" | "settled" | "cancelled";
export type DuelRoundStatus = "scheduled" | "live" | "completed";
export type DuelWinnerReason =
  | "higher-score"
  | "attention-dominance"
  | "roi-superiority"
  | "opponent-budget-exhausted"
  | "manual-settlement"
  | "tie-breaker";

export type TickerEventCategory =
  | "bid"
  | "duel"
  | "heatmap"
  | "alert"
  | "roi"
  | "autopilot"
  | "market";

export interface AttentionZone {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  weight?: number;
}

export interface AudienceSegmentSnapshot {
  segmentId: string;
  segmentName: string;
  category: string;
  region: string;
  deviceMix: Array<{ device: string; share: number }>;
  verifiedLtv: number;
  attentionScore: number;
  conversionRate: number;
  averageOrderValue: number;
  activeAdvertisers: number;
  categoryPressure: number;
  impressionsPerMinute: number;
  winningBid: number;
  floorBid: number;
  budgetCoverageHours: number;
  attentionZones: AttentionZone[];
  capturedAt: string;
}

export interface AttentionSample {
  sampleId: string;
  timestamp: string;
  x: number;
  y: number;
  intensity: number;
  dwellMs: number;
  attentionScore: number;
  engagementScore: number;
  focusScore: number;
  devicePixelRatio?: number;
  zoneId?: string;
  label?: string;
}

export interface AttentionMomentum {
  current: number;
  previous: number;
  delta: number;
  deltaPercent: number;
  direction: "up" | "down" | "flat";
}

export interface HeatmapFrame {
  frameId: string;
  campaignId: string;
  segmentId: string;
  width: number;
  height: number;
  refreshIntervalMs: number;
  capturedAt: string;
  samples: AttentionSample[];
  zones: AttentionZone[];
  momentum: AttentionMomentum;
}

export interface RoiStreak {
  campaignId: string;
  advertiserId: string;
  profitableDays: number;
  longestProfitableDays: number;
  lastProfitDate: string | null;
  currentRoas: number;
  targetRoas: number;
  consecutiveLossDays: number;
  averageProfitPerDay: number;
  lastSevenDayRoas: number[];
  statusLabel: string;
  momentum: "hot" | "warm" | "neutral" | "cooling";
}

export interface BidAutopilotDecision {
  decisionId: string;
  campaignId: string;
  advertiserId: string;
  segmentId: string;
  currentBid: number;
  recommendedBid: number;
  percentChange: number;
  confidence: number;
  expectedLift: number;
  expectedSavings: number;
  riskScore: number;
  rationale: string[];
  trustMessage: string;
  executeBy: string;
  createdAt: string;
}

export interface CampaignPerformanceSnapshot {
  campaignId: string;
  advertiserId: string;
  category: string;
  budgetRemaining: number;
  dailyBudget: number;
  spendToday: number;
  impressions: number;
  clicks: number;
  outcomes: number;
  conversions: number;
  revenue: number;
  roi: number;
  roas: number;
  averageCpc: number;
  averageOutcomeCost: number;
  attentionScore: number;
  shareOfVoice: number;
  bid: number;
  targetBid: number;
  targetRoas: number;
  launchTs: string;
  updatedAt: string;
}

export interface CompetitorSnapshot {
  advertiserId: string;
  campaignId: string;
  campaignName: string;
  category: string;
  segmentId: string;
  region: string;
  budgetRemaining: number;
  dailyBudget: number;
  currentBid: number;
  shareOfVoice: number;
  attentionScore: number;
  roi: number;
  roas: number;
  growthRate: number;
  launchedAt: string;
  updatedAt: string;
}

export interface CompetitorAlert {
  alertId: string;
  advertiserId: string;
  campaignId: string;
  segmentId: string;
  category: string;
  type: AlertType;
  severity: AlertSeverity;
  status: AlertStatus;
  headline: string;
  summary: string;
  recommendedAction: string;
  deltaValue: number;
  deltaPercent: number;
  urgencyScore: number;
  createdAt: string;
  expiresAt: string;
  metadata: Record<string, string | number | boolean | null>;
}

export interface CampaignBidProfile {
  advertiserId: string;
  campaignId: string;
  campaignName: string;
  baseOutcomePrice: number;
  currentBid: number;
  maxBid: number;
  minBid: number;
  budgetRemaining: number;
  targetRoas: number;
  verifiedLtv: number;
  intentScore: number;
  conversionRate: number;
  recencyMultiplier?: number;
}

export interface DuelContestant {
  contestantId: string;
  advertiserId: string;
  campaignId: string;
  campaignName: string;
  bidProfile: CampaignBidProfile;
  performance: CampaignPerformanceSnapshot;
  autopilotEnabled: boolean;
  autopilotDecision?: BidAutopilotDecision;
  streak: RoiStreak;
}

export interface DuelRoundTelemetry {
  impressionsWon: number;
  attentionCapture: number;
  conversions: number;
  spend: number;
  revenue: number;
  shareOfVoice: number;
  reactionLatencyMs: number;
}

export interface DuelRound {
  roundId: string;
  duelId: string;
  status: DuelRoundStatus;
  startedAt: string;
  endedAt?: string;
  audiencePressure: number;
  heat: number;
  scoreByContestant: Record<string, number>;
  telemetryByContestant: Record<string, DuelRoundTelemetry>;
  autopilotDecisions: BidAutopilotDecision[];
  alerts: CompetitorAlert[];
  winningContestantId?: string;
  winningReason?: DuelWinnerReason;
}

export interface DuelSettlement {
  settlementId: string;
  duelId: string;
  winnerContestantId: string;
  loserContestantId: string;
  winnerVisibilityMultiplier: number;
  loserRefundAmount: number;
  loserRefundReason: string;
  reason: DuelWinnerReason;
  settledAt: string;
}

export interface CampaignDuel {
  duelId: string;
  segment: AudienceSegmentSnapshot;
  status: DuelStatus;
  createdAt: string;
  updatedAt: string;
  contestants: [DuelContestant, DuelContestant];
  rounds: DuelRound[];
  currentLeaderId?: string;
  alertStream: CompetitorAlert[];
  settlement?: DuelSettlement;
}

export interface TickerEventActor {
  advertiserId: string;
  campaignId: string;
  displayName: string;
}

export interface TickerEvent {
  eventId: string;
  category: TickerEventCategory;
  ts: string;
  headline: string;
  body: string;
  value?: number;
  changePercent?: number;
  segmentId?: string;
  segmentName?: string;
  actor?: TickerEventActor;
  severity?: AlertSeverity;
  tags: string[];
  metadata: Record<string, string | number | boolean | null>;
}

export interface TickerSummaryCard {
  id: string;
  label: string;
  value: string;
  tone: "neutral" | "positive" | "warning" | "critical";
  detail: string;
}

export interface TickerLane {
  laneId: string;
  title: string;
  events: TickerEvent[];
}

export interface TickerAutopilotPanel {
  enabledCampaigns: number;
  decisions: BidAutopilotDecision[];
  averageLift: number;
  averageSavings: number;
  trustHeadline: string;
}

export interface TickerAlertPanel {
  total: number;
  critical: number;
  warning: number;
  informational: number;
  highlights: CompetitorAlert[];
}

export interface TickerDuelPanel {
  activeDuels: number;
  topDuels: Array<{
    duelId: string;
    segmentName: string;
    leaderName: string;
    pressure: number;
    heat: number;
  }>;
}

export interface AuctionTickerViewModel {
  generatedAt: string;
  headline: string;
  feed: TickerLane[];
  summaryCards: TickerSummaryCard[];
  autopilotPanel: TickerAutopilotPanel;
  alertPanel: TickerAlertPanel;
  duelPanel: TickerDuelPanel;
  streaks: RoiStreak[];
}

export interface CompetitorAlertContext {
  segment: AudienceSegmentSnapshot;
  focusCampaign: CampaignPerformanceSnapshot;
  focusStreak: RoiStreak;
  focusBidProfile: CampaignBidProfile;
  autopilotDecision?: BidAutopilotDecision;
  competitors: CompetitorSnapshot[];
}

export interface CompetitorAlertEvaluation {
  alerts: CompetitorAlert[];
  highestSeverity: AlertSeverity;
  recommendedBidFloor: number;
  averageCompetitorBid: number;
  shareOfVoiceGap: number;
}

export interface HeatmapPaletteStop {
  offset: number;
  color: string;
  alpha: number;
}

export interface HeatmapLegendItem {
  label: string;
  color: string;
  value: number;
}

export interface HeatmapRenderStats {
  frameId: string;
  renderedAt: string;
  sampleCount: number;
  averageIntensity: number;
  hottestZoneId: string | null;
  hottestZoneLabel: string | null;
  attentionMomentum: AttentionMomentum;
}

export interface Subscription<T> {
  unsubscribe: () => void;
  current: T;
}

export const clamp = (value: number, minimum: number, maximum: number): number => {
  return Math.min(Math.max(value, minimum), maximum);
};

export const round = (value: number, digits = 2): number => {
  return Number(value.toFixed(digits));
};

export const sum = (values: number[]): number => {
  return values.reduce((total, value) => total + value, 0);
};

export const average = (values: number[]): number => {
  return values.length ? sum(values) / values.length : 0;
};

export const uniqueBy = <T>(items: T[], getKey: (item: T) => string): T[] => {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const key = getKey(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }

  return result;
};

export const sortByTsDescending = <T>(items: T[], getTs: (item: T) => string): T[] => {
  return [...items].sort((left, right) => Date.parse(getTs(right)) - Date.parse(getTs(left)));
};

export const severityWeight = (severity: AlertSeverity): number => {
  switch (severity) {
    case "critical":
      return 3;
    case "warning":
      return 2;
    default:
      return 1;
  }
};

export const getHighestSeverity = (alerts: CompetitorAlert[]): AlertSeverity => {
  if (alerts.some((alert) => alert.severity === "critical")) {
    return "critical";
  }
  if (alerts.some((alert) => alert.severity === "warning")) {
    return "warning";
  }
  return "info";
};

export const formatCurrency = (value: number, currency: CurrencyCode = "USD"): string => {
  const prefix = currency === "USD" || currency === "USDC" || currency === "USDT" || currency === "DAI"
    ? "$"
    : `${currency} `;
  return `${prefix}${round(value, 2).toFixed(2)}`;
};

export const createMomentum = (current: number, previous: number): AttentionMomentum => {
  const delta = current - previous;
  const deltaPercent = previous === 0 ? (current > 0 ? 100 : 0) : (delta / previous) * 100;

  return {
    current: round(current, 4),
    previous: round(previous, 4),
    delta: round(delta, 4),
    deltaPercent: round(deltaPercent, 2),
    direction: delta > 0.005 ? "up" : delta < -0.005 ? "down" : "flat"
  };
};

export const createStatusLabel = (streak: RoiStreak): string => {
  if (streak.profitableDays >= 14) {
    return `${streak.profitableDays}-day money streak`;
  }
  if (streak.profitableDays >= 7) {
    return `${streak.profitableDays}-day ROI heater`;
  }
  if (streak.consecutiveLossDays >= 3) {
    return `loss streak ${streak.consecutiveLossDays}`;
  }
  return streak.profitableDays > 0 ? `${streak.profitableDays}-day profitable run` : "seeking breakout";
};
