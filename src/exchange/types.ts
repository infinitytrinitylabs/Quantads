export type ExchangePlatform = "quanttube" | "quantedits" | "quantchill" | "quantchat" | "quantmail" | "quantbrowse";
export type DeviceCategory = "desktop" | "mobile" | "tablet" | "tv" | "unknown";
export type ConnectionType = "wifi" | "cellular" | "ethernet" | "offline" | "unknown";
export type OperatingSystem = "ios" | "android" | "windows" | "macos" | "linux" | "other";
export type BrowserFamily = "chrome" | "safari" | "firefox" | "edge" | "bot" | "other";
export type ExchangeBidStatus = "accepted" | "rejected" | "shadowed";
export type TrafficQualityTier = "premium" | "standard" | "discounted" | "blocked";
export type AuctionSettlementStatus = "leading" | "outbid" | "won" | "lost" | "rejected";
export type DashboardTimeGranularity = "minute" | "hour";
export type AnalyticsEventType =
  | "auction-requested"
  | "bid-accepted"
  | "bid-rejected"
  | "auction-won"
  | "auction-lost"
  | "attention-updated"
  | "fraud-detected";

export interface ExchangeViewport {
  width: number;
  height: number;
  density: number;
}

export interface PointerSample {
  dx: number;
  dy: number;
  dtMs: number;
}

export interface ScrollSample {
  offset: number;
  velocity: number;
  dwellMs: number;
}

export interface ExchangeInteractionSnapshot {
  focusDurationMs: number;
  pointerEvents: number;
  pointerSamples?: PointerSample[];
  scrollDepth: number;
  scrollSamples?: ScrollSample[];
  keyEvents: number;
  rageClicks: number;
  copyPasteEvents: number;
  hoverTargets: number;
  formInteractions: number;
  mediaPlayheadMs?: number;
}

export interface ExchangeAudienceSignal {
  verifiedLtv: number;
  intentScore: number;
  conversionRate: number;
  recencyMultiplier?: number;
  attentionScore?: number;
  cohortQualityScore?: number;
  historicalCtr?: number;
  historicalOutcomeRate?: number;
}

export interface ExchangePlacementContext {
  auctionId: string;
  slotId: string;
  campaignId: string;
  platform: ExchangePlatform;
  pageUrl: string;
  placementPath: string;
  adFormat: "native-card" | "story" | "search" | "rewarded" | "video" | "display";
  viewport: ExchangeViewport;
  viewabilityEstimate: number;
  floorPrice: number;
  reservePrice?: number;
  marketPressure?: number;
  publisherQualityScore?: number;
  contentSafetyScore?: number;
  geo?: {
    country: string;
    region?: string;
    city?: string;
    timezoneOffsetMinutes?: number;
  };
}

export interface ExchangeTrafficFingerprint {
  sessionId: string;
  userId?: string;
  ipHash: string;
  deviceIdHash?: string;
  userAgent: string;
  deviceCategory: DeviceCategory;
  operatingSystem: OperatingSystem;
  browserFamily: BrowserFamily;
  language?: string;
  connectionType?: ConnectionType;
  localHour?: number;
  tabCount?: number;
  pageViewsInSession?: number;
  referrer?: string;
  screenColorDepth?: number;
  timezoneOffsetMinutes?: number;
}

export interface ExchangeBidRequest {
  advertiserId: string;
  agencyId: string;
  creativeId: string;
  outcomeType: string;
  baseOutcomePrice: number;
  bidCeiling?: number;
  outcomeCount: number;
  pricingCurrency?: string;
  placement: ExchangePlacementContext;
  audience: ExchangeAudienceSignal;
  fingerprint: ExchangeTrafficFingerprint;
  interaction: ExchangeInteractionSnapshot;
  settlementAddress: string;
  settlementNetwork: string;
  requestId?: string;
  occurredAt?: string;
}

export interface IsolationFeatureVector {
  values: number[];
  labels: string[];
}

export interface FraudRuleSignal {
  id: string;
  label: string;
  weight: number;
  score: number;
  reason: string;
  category: "velocity" | "device" | "engagement" | "timing" | "network" | "signature";
}

export interface BotHeuristicsResult {
  score: number;
  confidence: number;
  suspected: boolean;
  tier: TrafficQualityTier;
  reasons: string[];
  triggeredRules: FraudRuleSignal[];
  featureSnapshot: Record<string, number | string | boolean | null>;
}

export interface IsolationTreeSnapshot {
  treeIndex: number;
  depth: number;
  mass: number;
  normalizedDepth: number;
}

export interface IsolationForestResult {
  score: number;
  normalizedScore: number;
  suspected: boolean;
  reason: string;
  sampleSize: number;
  featureVector: IsolationFeatureVector;
  treeSnapshots: IsolationTreeSnapshot[];
}

export interface CombinedFraudAssessment {
  combinedScore: number;
  trustedTrafficScore: number;
  suspected: boolean;
  decision: ExchangeBidStatus;
  tier: TrafficQualityTier;
  heuristics: BotHeuristicsResult;
  isolationForest: IsolationForestResult;
  reviewReasons: string[];
}

export interface AttentionPricingBreakdown {
  baseBid: number;
  audienceBid: number;
  attentionMultiplier: number;
  attentionPriceLift: number;
  trustMultiplier: number;
  qualityMultiplier: number;
  viewabilityMultiplier: number;
  marketMultiplier: number;
  finalBid: number;
  cappedByCeiling: boolean;
}

export interface RankedExchangeBid {
  requestId: string;
  advertiserId: string;
  campaignId: string;
  slotId: string;
  creativeId: string;
  submittedAt: string;
  status: ExchangeBidStatus;
  settlementStatus: AuctionSettlementStatus;
  finalBid: number;
  rankedBid: number;
  clearingPrice: number | null;
  reservePrice: number;
  attentionMultiplier: number;
  fraudScore: number;
  trustedTrafficScore: number;
  qualityTier: TrafficQualityTier;
  diagnostics: CombinedFraudAssessment;
  pricing: AttentionPricingBreakdown;
}

export interface ExchangeAuctionSnapshot {
  auctionId: string;
  slotId: string;
  campaignId: string;
  reservePrice: number;
  requestedAt: string;
  totalRequests: number;
  acceptedBids: number;
  rejectedBids: number;
  winner: RankedExchangeBid | null;
  leaderboard: RankedExchangeBid[];
  secondPrice: number | null;
  averageAttentionMultiplier: number;
  averageFraudScore: number;
}

export interface ExchangeBidResponse {
  requestId: string;
  auctionId: string;
  slotId: string;
  advertiserId: string;
  campaignId: string;
  creativeId: string;
  status: ExchangeBidStatus;
  settlementStatus: AuctionSettlementStatus;
  finalBid: number;
  rankedBid: number;
  clearingPrice: number | null;
  reservePrice: number;
  rank: number | null;
  isWinner: boolean;
  secondPrice: number | null;
  priceToBeat: number | null;
  pricing: AttentionPricingBreakdown;
  diagnostics: CombinedFraudAssessment;
  leaderboard: RankedExchangeBid[];
}

export interface ExchangeTimeseriesPoint {
  bucketStart: string;
  requests: number;
  acceptedBids: number;
  rejectedBids: number;
  wins: number;
  spend: number;
  clearingSpend: number;
  revenueProxy: number;
  averageBid: number;
  averageClearingPrice: number;
  averageAttentionScore: number;
  averageFraudScore: number;
  attentionWeightedBid: number;
  suspiciousTrafficRate: number;
  botTrafficRate: number;
  winRate: number;
  outcomeRateProxy: number;
}

export interface AdvertiserSummaryCard {
  advertiserId: string;
  totalRequests: number;
  acceptedBids: number;
  rejectedBids: number;
  wins: number;
  totalSpend: number;
  totalClearingSpend: number;
  averageBid: number;
  averageClearingPrice: number;
  averageAttentionScore: number;
  averageFraudScore: number;
  suspiciousTrafficRate: number;
  botTrafficRate: number;
  winRate: number;
  estimatedOutcomes: number;
  estimatedRoas: number;
  activeCampaigns: number;
  latestActivityAt: string | null;
}

export interface QualityBreakdown {
  tier: TrafficQualityTier;
  requests: number;
  acceptedBids: number;
  rejectedBids: number;
  wins: number;
  spend: number;
  averageAttentionScore: number;
  averageFraudScore: number;
  winRate: number;
}

export interface CampaignDashboardSnapshot {
  campaignId: string;
  slotIds: string[];
  summary: AdvertiserSummaryCard;
  qualityBreakdown: QualityBreakdown[];
  timeline: ExchangeTimeseriesPoint[];
}

export interface AdvertiserDashboardSnapshot {
  advertiserId: string;
  generatedAt: string;
  granularity: DashboardTimeGranularity;
  summary: AdvertiserSummaryCard;
  qualityBreakdown: QualityBreakdown[];
  campaignSnapshots: CampaignDashboardSnapshot[];
  topCreatives: Array<{
    creativeId: string;
    requests: number;
    wins: number;
    spend: number;
    clearingSpend: number;
    winRate: number;
    averageAttentionScore: number;
  }>;
  liveAuctions: ExchangeAuctionSnapshot[];
  timeline: ExchangeTimeseriesPoint[];
  lastEvent?: ExchangeAnalyticsEvent;
}

export interface ExchangeAnalyticsEvent {
  eventId: string;
  eventType: AnalyticsEventType;
  advertiserId: string;
  campaignId: string;
  slotId: string;
  auctionId: string;
  creativeId: string;
  requestId: string;
  occurredAt: string;
  payload: {
    bidAmount: number;
    rankedBid: number;
    clearingPrice: number | null;
    attentionScore: number;
    attentionMultiplier: number;
    fraudScore: number;
    trustedTrafficScore: number;
    suspiciousTraffic: boolean;
    qualityTier: TrafficQualityTier;
    wonAuction: boolean;
    rejected: boolean;
    viewabilityEstimate: number;
    marketPressure: number;
    estimatedOutcomeRate: number;
  };
}

export interface DashboardSocketEnvelope {
  type: "hello" | "snapshot" | "event" | "error" | "heartbeat";
  advertiserId?: string;
  generatedAt: string;
  payload: Record<string, unknown>;
}

export interface AnalyticsQueryOptions {
  advertiserId: string;
  granularity?: DashboardTimeGranularity;
  limit?: number;
}

export interface LiveAuctionFilter {
  advertiserId: string;
  limit?: number;
}

export interface ExchangeEngineConfig {
  minimumTrustedTrafficScore: number;
  suspiciousTrafficThreshold: number;
  blockedTrafficThreshold: number;
  secondPriceIncrement: number;
  maxLeaderboardSize: number;
  liveAuctionLimit: number;
}

export interface AuctionBookEntry {
  request: ExchangeBidRequest;
  response: ExchangeBidResponse;
}

export interface AnalyticsAccumulator {
  requests: number;
  acceptedBids: number;
  rejectedBids: number;
  wins: number;
  spend: number;
  clearingSpend: number;
  attentionScoreTotal: number;
  fraudScoreTotal: number;
  suspiciousTrafficCount: number;
  botTrafficCount: number;
  revenueProxy: number;
  estimatedOutcomes: number;
}

export interface CreativePerformanceSnapshot {
  creativeId: string;
  requests: number;
  wins: number;
  spend: number;
  clearingSpend: number;
  attentionScoreTotal: number;
}
