import { BiddingEngine } from "../bidding/BiddingEngine";

export type YieldCreativeStyle = "micro-burst" | "narrative" | "native-card" | "rewarded";
export type YieldSlotFormat = "display" | "video" | "native" | "rewarded";

export interface YieldAudienceSignal {
  verifiedLtv: number;
  intentScore: number;
  conversionRate: number;
  recencyMultiplier?: number;
  attentionScore?: number;
}

export interface PulseSnapshot {
  attentionDepth: number;
  cognitiveLoad: number;
  dwellTimeMs: number;
  eyeAlignment: number;
  scrollVelocity: number;
}

export interface YieldSlotDescriptor {
  platform: "quanttube" | "quantedits" | "quantchill" | "quantchat" | "quantmail" | "quantbrowse";
  placementPath: string;
  adFormat: YieldSlotFormat;
  floorCpm: number;
  viewabilityEstimate: number;
  preferredCreativeStyle?: YieldCreativeStyle;
}

export interface DspBid {
  bidId: string;
  bidderId: string;
  campaignId: string;
  creativeId: string;
  creativeStyle: YieldCreativeStyle;
  bidCpm: number;
  responseLatencyMs: number;
  predictedCtr: number;
  predictedConversionRate: number;
  qualityScore: number;
  attentionAffinity?: number;
}

export interface BidAggregationRequest {
  advertiserId: string;
  auctionId: string;
  slotId: string;
  baseOutcomePrice: number;
  audience: YieldAudienceSignal;
  pulse: PulseSnapshot;
  slot: YieldSlotDescriptor;
  bids: DspBid[];
  timeoutBudgetMs?: number;
}

export interface RankedYieldBid {
  bidId: string;
  bidderId: string;
  campaignId: string;
  creativeId: string;
  creativeStyle: YieldCreativeStyle;
  bidCpm: number;
  responseLatencyMs: number;
  timedOut: boolean;
  attentionFit: number;
  formatCompatibility: number;
  effectiveCpm: number;
  expectedOutcomeRate: number;
  effectiveCostPerOutcome: number;
  arbitrageSpread: number;
  expectedYieldScore: number;
  confidence: number;
}

export interface BidAggregationResult {
  baselineOutcomeBid: number;
  timeoutBudgetMs: number;
  rankedBids: RankedYieldBid[];
}

const DEFAULT_TIMEOUT_BUDGET_MS = 10;

const clamp = (value: number, minimum: number, maximum: number): number => {
  if (!Number.isFinite(value)) {
    return minimum;
  }

  return Math.min(Math.max(value, minimum), maximum);
};

const round = (value: number, digits = 4): number => {
  return Number(value.toFixed(digits));
};

const formatCompatibility = (
  slotFormat: YieldSlotFormat,
  creativeStyle: YieldCreativeStyle,
  preferredCreativeStyle?: YieldCreativeStyle
): number => {
  if (preferredCreativeStyle && preferredCreativeStyle === creativeStyle) {
    return 1.08;
  }

  const matrix: Record<YieldSlotFormat, Record<YieldCreativeStyle, number>> = {
    display: {
      "micro-burst": 0.98,
      narrative: 0.82,
      "native-card": 1.02,
      rewarded: 0.74
    },
    video: {
      "micro-burst": 0.96,
      narrative: 1.08,
      "native-card": 0.84,
      rewarded: 0.94
    },
    native: {
      "micro-burst": 0.9,
      narrative: 0.95,
      "native-card": 1.1,
      rewarded: 0.8
    },
    rewarded: {
      "micro-burst": 0.88,
      narrative: 0.9,
      "native-card": 0.76,
      rewarded: 1.12
    }
  };

  return matrix[slotFormat][creativeStyle];
};

const attentionFit = (creativeStyle: YieldCreativeStyle, pulse: PulseSnapshot, bid: DspBid): number => {
  const normalizedDwell = clamp(pulse.dwellTimeMs / 20_000, 0, 1.2);
  const attentionAffinity = clamp(bid.attentionAffinity ?? 0.75, 0, 1);
  const lowCognitiveLoad = 1 - clamp(pulse.cognitiveLoad, 0, 1);
  const lowScrollVelocity = 1 - clamp(pulse.scrollVelocity, 0, 1.5) / 1.5;

  // These weights are tuned so the dominant signal for each creative family matches
  // the monetization thesis: narrative ads need dwell + available attention, native
  // cards need stable browsing posture, and micro-burst / rewarded creatives remain
  // viable in higher-load moments because they monetize brief interruptible windows.
  // Each style keeps a 1.0 total weight but shifts emphasis toward the signals that
  // historically matter most for that delivery pattern.
  const styleScore: Record<YieldCreativeStyle, number> = {
    "micro-burst": 0.45 * pulse.attentionDepth + 0.2 * pulse.eyeAlignment + 0.2 * pulse.cognitiveLoad + 0.15 * lowScrollVelocity,
    narrative: 0.4 * pulse.attentionDepth + 0.25 * normalizedDwell + 0.2 * lowCognitiveLoad + 0.15 * pulse.eyeAlignment,
    "native-card": 0.35 * pulse.attentionDepth + 0.2 * lowScrollVelocity + 0.2 * pulse.eyeAlignment + 0.25 * lowCognitiveLoad,
    rewarded: 0.28 * pulse.attentionDepth + 0.32 * normalizedDwell + 0.2 * pulse.eyeAlignment + 0.2 * pulse.cognitiveLoad
  };

  return clamp(styleScore[creativeStyle] * attentionAffinity, 0.45, 1.25);
};

export class BidAggregator {
  private readonly biddingEngine = new BiddingEngine();

  aggregate(request: BidAggregationRequest): BidAggregationResult {
    const timeoutBudgetMs = request.timeoutBudgetMs ?? DEFAULT_TIMEOUT_BUDGET_MS;
    const baselineOutcomeBid = this.biddingEngine.calculateOutcomeBid({
      baseOutcomePrice: request.baseOutcomePrice,
      audience: request.audience,
      marketPressure: 1 + (request.slot.viewabilityEstimate - 0.5) * 0.2,
      floorPrice: request.baseOutcomePrice * 0.8,
      maxPrice: request.baseOutcomePrice * 4,
      riskTolerance: clamp(0.45 - request.pulse.attentionDepth * 0.2, 0.1, 0.6)
    }).finalBid;

    const rankedBids = request.bids
      .map((bid) => this.rankBid(request, bid, baselineOutcomeBid, timeoutBudgetMs))
      .sort(
        (left, right) =>
          right.expectedYieldScore - left.expectedYieldScore ||
          right.arbitrageSpread - left.arbitrageSpread ||
          left.responseLatencyMs - right.responseLatencyMs
      );

    return {
      baselineOutcomeBid: round(baselineOutcomeBid, 2),
      timeoutBudgetMs,
      rankedBids
    };
  }

  private rankBid(
    request: BidAggregationRequest,
    bid: DspBid,
    baselineOutcomeBid: number,
    timeoutBudgetMs: number
  ): RankedYieldBid {
    const timedOut = bid.responseLatencyMs > timeoutBudgetMs;
    const compatibility = formatCompatibility(
      request.slot.adFormat,
      bid.creativeStyle,
      request.slot.preferredCreativeStyle
    );
    const fit = attentionFit(bid.creativeStyle, request.pulse, bid);
    const quality = clamp(bid.qualityScore, 0.3, 1);
    const viewabilityLift = clamp(0.75 + request.slot.viewabilityEstimate * 0.45, 0.75, 1.2);
    const effectiveCpm = timedOut
      ? 0
      : bid.bidCpm * compatibility * fit * quality * viewabilityLift;

    // Conversion forecast intentionally carries the highest weight because yield
    // depends on verified outcomes, while CTR and attention act as earlier-funnel
    // confidence modifiers around the advertiser's baseline audience priors.
    const expectedOutcomeRate = timedOut
      ? 0
      : clamp(
          bid.predictedCtr * 0.22 +
            bid.predictedConversionRate * 0.48 +
            request.audience.conversionRate * 0.18 +
            request.audience.intentScore * 0.07 +
            clamp(request.audience.attentionScore ?? request.pulse.attentionDepth, 0, 1) * 0.05,
          0.005,
          0.95
        );
    const effectiveCostPerOutcome =
      expectedOutcomeRate > 0 ? effectiveCpm / (1000 * expectedOutcomeRate) : Number.POSITIVE_INFINITY;
    const arbitrageSpread = timedOut ? -baselineOutcomeBid : baselineOutcomeBid - effectiveCostPerOutcome;
    const confidence = timedOut
      ? 0
      : clamp(
          compatibility * 0.3 +
            fit * 0.3 +
            quality * 0.2 +
            (1 - clamp(bid.responseLatencyMs / Math.max(timeoutBudgetMs, 1), 0, 1)) * 0.2,
          0,
          1
        );
    const expectedYieldScore = timedOut
      ? -1
      : arbitrageSpread * (0.7 + confidence * 0.6) + expectedOutcomeRate * baselineOutcomeBid * 0.08;

    return {
      bidId: bid.bidId,
      bidderId: bid.bidderId,
      campaignId: bid.campaignId,
      creativeId: bid.creativeId,
      creativeStyle: bid.creativeStyle,
      bidCpm: round(bid.bidCpm),
      responseLatencyMs: round(bid.responseLatencyMs, 3),
      timedOut,
      attentionFit: round(fit),
      formatCompatibility: round(compatibility),
      effectiveCpm: round(effectiveCpm),
      expectedOutcomeRate: round(expectedOutcomeRate, 6),
      effectiveCostPerOutcome:
        Number.isFinite(effectiveCostPerOutcome) ? round(effectiveCostPerOutcome) : Number.POSITIVE_INFINITY,
      arbitrageSpread: round(arbitrageSpread),
      expectedYieldScore: round(expectedYieldScore),
      confidence: round(confidence)
    };
  }
}
