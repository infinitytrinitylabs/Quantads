export interface Coordinate {
  latitude: number;
  longitude: number;
}

export interface GeofenceTarget extends Coordinate {
  radiusMeters: number;
}

export interface QuantchatMultiplierConfig {
  multiplier: number;
  claimWindowSeconds: number;
}

export interface WebGLOverlayConfig {
  sceneId: string;
  assetUrl: string;
  shaderPreset: "billboard" | "portal" | "lightfield";
  anchorMode: "world-locked";
  ctaLabel: string;
}

export interface ArLocalizedAdCampaign {
  id: string;
  title: string;
  target: GeofenceTarget;
  notificationTitle: string;
  notificationBody: string;
  webglOverlay: WebGLOverlayConfig;
  quantchatMultiplier: QuantchatMultiplierConfig;
}

export interface LocationEvent {
  userId: string;
  coordinate: Coordinate;
  occurredAt: string;
  platform: "ios" | "android" | "web";
}

export interface LocalNotificationAction {
  id: string;
  title: string;
  body: string;
  scheduleAt: string;
  channelId: string;
  deepLink: string;
  extras: Record<string, string | number | boolean>;
}

export interface ArLaunchState {
  openCameraView: boolean;
  experienceRoute: string;
  overlay: WebGLOverlayConfig;
  campaignId: string;
  userCoordinate: Coordinate;
}

export interface QuantchatBonusResult {
  eligible: boolean;
  multiplier: number;
  reason: "within-window" | "outside-window" | "notification-not-opened";
}

export interface EncounterResult {
  triggered: boolean;
  distanceMeters: number;
  notification?: LocalNotificationAction;
  arLaunchState?: ArLaunchState;
}

export interface SimulatedAudienceMember {
  userId: string;
  route: Coordinate[];
  quantchatOpenDelaySeconds?: number;
}

export interface TwinSimulationRequest {
  campaign: ArLocalizedAdCampaign;
  audience: SimulatedAudienceMember[];
}

export interface TwinSimulationSummary {
  triggerCount: number;
  projectedNotificationOpens: number;
  projectedQuantchatBonusClaims: number;
  averageTriggerDistanceMeters: number;
}

export interface TwinSimulationResponse {
  summary: TwinSimulationSummary;
  users: Array<{
    userId: string;
    triggered: boolean;
    distanceMeters: number | null;
    notificationDeepLink?: string;
    quantchatBonusEligible?: boolean;
  }>;
}

export type SurfaceKind = "table" | "wall" | "container" | "shelf";

export interface SurfaceCandidateInput {
  kind: SurfaceKind;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  luma: number;
  occlusion: number;
}

export interface TwinFrameInput {
  frameId: string;
  timestampMs: number;
  width: number;
  height: number;
  candidates: SurfaceCandidateInput[];
}

export interface TwinBrandedAsset {
  assetId: string;
  brandName: string;
  productName: string;
  preferredSurface: SurfaceKind;
  baseScale: number;
}

export interface TwinFocusEvent {
  frameId: string;
  timestampMs: number;
  x: number;
  y: number;
  gazeIntensity: number;
}

export interface TwinAudienceSession {
  userId: string;
  focusEvents: TwinFocusEvent[];
}

export interface NeuromorphicTwinSimulationRequest {
  mode: "neuromorphic";
  campaign: {
    id: string;
    title: string;
    objective?: string;
  };
  frames: TwinFrameInput[];
  assets: TwinBrandedAsset[];
  sessions: TwinAudienceSession[];
}

export interface NeuromorphicDetectedSurface {
  surfaceId: string;
  frameId: string;
  kind: SurfaceKind;
  plane: {
    nx: number;
    ny: number;
    nz: number;
    depth: number;
  };
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  lighting: {
    luma: number;
    temperatureKelvin: number;
  };
  occlusionMap: {
    blockedRatio: number;
    confidence: number;
  };
  confidence: number;
}

export interface NeuromorphicInsertion {
  insertionId: string;
  frameId: string;
  surfaceId: string;
  assetId: string;
  transform: {
    x: number;
    y: number;
    scale: number;
    perspective: number;
  };
  postProcessing: {
    grain: number;
    motionBlur: number;
    colorMatch: number;
  };
  invisibilityScore: number;
}

export interface NeuromorphicAssetEngagement {
  assetId: string;
  focusedMilliseconds: number;
  weightedAttentionSeconds: number;
  engagedUsers: number;
}

export interface NeuromorphicTwinSimulationResponse {
  mode: "neuromorphic";
  campaignId: string;
  summary: {
    analyzedFrames: number;
    detectedSurfaces: number;
    insertedAssets: number;
    averageInvisibilityScore: number;
    estimatedNativeEngagementSeconds: number;
    highIntentUsers: number;
  };
  surfaces: NeuromorphicDetectedSurface[];
  insertions: NeuromorphicInsertion[];
  engagementByAsset: NeuromorphicAssetEngagement[];
}

export type TwinSimulationApiRequest = TwinSimulationRequest | NeuromorphicTwinSimulationRequest;
export type TwinSimulationApiResponse = TwinSimulationResponse | NeuromorphicTwinSimulationResponse;

export interface AudiencePricingSignal {
  verifiedLtv: number;
  intentScore: number;
  conversionRate: number;
  recencyMultiplier?: number;
  attentionScore?: number;
}

export interface AuctionBidRequest {
  advertiserId: string;
  agencyId: string;
  outcomeType: string;
  baseOutcomePrice: number;
  audience: AudiencePricingSignal;
  marketPressure?: number;
  floorPrice?: number;
  maxPrice?: number;
  riskTolerance?: number;
  outcomeCount: number;
  settlementAddress: string;
  settlementNetwork: string;
  currency?: string;
  reservePrice?: number;
  priorityBoost?: number;
  expectedRevenuePerOutcome?: number;
  authorization?: {
    payerWallet: string;
    transactionHash: string;
    amount: number;
    currency: string;
  };
}

export interface AuctionLeaderboardEntry {
  bidId: string;
  advertiserId: string;
  finalBid: number;
  auctionScore: number;
  rank: number;
  paymentStatus: "quoted" | "settled";
  submittedAt: string;
}

export interface AuctionBidResponse {
  campaignId: string;
  bidId: string;
  advertiserId: string;
  agencyId: string;
  outcomeType: string;
  finalBid: number;
  reservePrice: number;
  auctionScore: number;
  rank: number;
  isWinning: boolean;
  recommendedBidToWin: number | null;
  paymentStatus: "quoted" | "settled";
  invoiceId: string;
  leaderboard: AuctionLeaderboardEntry[];
  quote: {
    invoiceId: string;
    totalAmount: number;
    currency: string;
    paymentEndpoint: string;
  };
}

export interface OutcomeReportRequest {
  invoiceId: string;
  outcomeType: string;
  outcomeCount: number;
  valueGenerated: number;
  verifier: string;
  transactionHash: string;
  occurredAt?: string;
}

export interface OutcomeReportEntry {
  outcomeType: string;
  outcomeCount: number;
  valueGenerated: number;
  verifier: string;
  transactionHash: string;
  occurredAt: string;
}

export interface InvoiceOutcomeLedger {
  invoiceId: string;
  campaignId: string;
  advertiserId: string;
  agencyId: string;
  outcomeType: string;
  quotedOutcomeCount: number;
  unitPrice: number;
  quotedAmount: number;
  paymentStatus: "quoted" | "settled";
  settledAmount: number | null;
  reportedOutcomeCount: number;
  billableOutcomeCount: number;
  outcomeValueGenerated: number;
  deliveryProgress: number;
  roas: number;
  reports: OutcomeReportEntry[];
}

export interface OutcomePerformanceSummary {
  invoices: number;
  settledInvoices: number;
  quotedSpend: number;
  settledSpend: number;
  projectedOutcomes: number;
  reportedOutcomes: number;
  billableOutcomes: number;
  outcomeValueGenerated: number;
  outcomeBackedRoas: number;
  settlementCoverage: number;
}

export interface AuctionWinnerResponse {
  campaignId: string;
  winner: (AuctionLeaderboardEntry & {
    agencyId: string;
    outcomeType: string;
    reservePrice: number;
    invoiceId: string;
    delivery?: InvoiceOutcomeLedger;
  }) | null;
  leaderboard: AuctionLeaderboardEntry[];
}

// ── Campaign & Ad Exchange ────────────────────────────────────────────────────

export type CampaignStatus = "active" | "paused" | "depleted" | "deleted";

export interface Creative {
  id: string;
  campaignId: string;
  url: string;
  format: "banner" | "video" | "native";
  previewUrl?: string;
  createdAt: string;
}

export interface Campaign {
  id: string;
  advertiserId: string;
  name: string;
  budget: number;
  totalSpend: number;
  status: CampaignStatus;
  targetingRules: CampaignTargetingRules;
  creatives: Creative[];
  createdAt: string;
  updatedAt: string;
}

export interface CampaignTargetingRules {
  ageMin?: number;
  ageMax?: number;
  interests?: string[];
  attentionThreshold?: number;   // minimum attention score 0–1
  geoRadius?: { latitude: number; longitude: number; radiusMeters: number };
}

export interface CampaignCreateRequest {
  name: string;
  budget: number;
  targetingRules: CampaignTargetingRules;
  creatives?: Array<{ url: string; format: "banner" | "video" | "native"; previewUrl?: string }>;
}

export interface CampaignUpdateRequest {
  name?: string;
  budget?: number;
  status?: "active" | "paused";
  targetingRules?: CampaignTargetingRules;
}

// ── Bid Processing ────────────────────────────────────────────────────────────

export interface BidRequest {
  campaignId: string;
  targetUserId: string;
  baseCpc: number;
  creativeId: string;
  advertiserBudget: number;
  attentionScore?: number;    // 0–1 from BCI pipeline
}

export interface BidResult {
  campaignId: string;
  creativeId: string;
  winnerId: string | null;
  winnerCpc: number;          // price winner actually pays (second-price)
  finalCpc: number;           // adjusted CPC before second-price
  isWinner: boolean;
  auctionRank: number;
  budgetExhausted: boolean;
}

export interface AuctionSlot {
  slotId: string;
  bids: ProcessedBid[];
  resolvedAt: string;
  winner: ProcessedBid | null;
  clearingPrice: number;
}

export interface ProcessedBid {
  campaignId: string;
  creativeId: string;
  finalCpc: number;
  attentionScore: number;
  advertiserId?: string;
}

// ── Impression & Click Tracking ───────────────────────────────────────────────

export interface Impression {
  id: string;
  adId: string;
  userId: string;
  attentionScore: number;
  dwellTimeMs: number;
  createdAt: string;
}

export interface Click {
  id: string;
  adId: string;
  userId: string;
  timestamp: string;
  impressionId: string;
  valid: boolean;
}

// ── Fraud Detection ───────────────────────────────────────────────────────────

export interface FraudFeatures {
  clickRate: number;          // clicks / impressions ratio
  avgDwellTime: number;       // ms
  attentionVariance: number;  // variance of attention scores
  uniqueIpCount: number;
  sessionDuration: number;    // ms
}

export interface FraudAlert {
  id: string;
  userId: string;
  anomalyScore: number;
  verdict: "clean" | "suspicious" | "blocked";
  features: FraudFeatures;
  heuristicFlags: string[];
  autoRefunded: boolean;
  createdAt: string;
}

export interface BotHeuristicInput {
  userId: string;
  dwellTimeSamples: number[];
  mouseMovementSamples: number[];
  locations: Array<{ latitude: number; longitude: number; timestampMs: number }>;
  browserFingerprint: {
    hasWebGL: boolean;
    hasAudioContext: boolean;
    userAgent: string;
    screenResolution?: string;
  };
}

// ── Campaign Analytics ────────────────────────────────────────────────────────

export interface CampaignAnalytics {
  campaignId: string;
  impressions: number;
  clicks: number;
  ctr: number;
  totalSpend: number;
  eCpm: number;
  averageAttentionScore: number;
  dailyBreakdown: DailyAnalyticsEntry[];
}

export interface DailyAnalyticsEntry {
  date: string;
  impressions: number;
  clicks: number;
  spend: number;
  averageAttentionScore: number;
}

// ── BCI Attention Tracking ─────────────────────────────────────────────────────

export interface BciAttentionSignal {
  userId: string;     // opaque – no PII
  sessionId: string;
  platform: string;
  campaignId?: string;
  attentionScore: number;   // 0–1
  engagementScore: number;  // 0–1
  focusScore: number;       // 0–1
  adExposureMs?: number;
  occurredAt?: string;
}

export interface BciIngestionResponse {
  signalId: string;
  userId: string;
  sessionId: string;
  platform: string;
  campaignId?: string;
  attentionScore: number;
  engagementScore: number;
  focusScore: number;
  adExposureMs?: number;
  occurredAt: string;
  compositeScore: number;
}
