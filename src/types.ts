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
