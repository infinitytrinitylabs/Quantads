export interface AudienceSignal {
  verifiedLtv: number;
  intentScore: number;
  conversionRate: number;
  recencyMultiplier?: number;
  attentionScore?: number;
}

export interface OutcomeBidRequest {
  baseOutcomePrice: number;
  audience: AudienceSignal;
  marketPressure?: number;
  floorPrice?: number;
  maxPrice?: number;
  riskTolerance?: number;
}

export interface OutcomeBidResult {
  finalBid: number;
  pricingModel: "outcome-based";
  breakdown: {
    baseOutcomePrice: number;
    ltvMultiplier: number;
    confidenceMultiplier: number;
    attentionMultiplier: number;
    marketMultiplier: number;
    riskMultiplier: number;
  };
}

const clamp = (value: number, minimum: number, maximum: number): number => {
  return Math.min(Math.max(value, minimum), maximum);
};

const roundCurrency = (value: number): number => {
  return Number(value.toFixed(2));
};

export class BiddingEngine {
  calculateOutcomeBid(request: OutcomeBidRequest): OutcomeBidResult {
    const { baseOutcomePrice, audience } = request;

    if (baseOutcomePrice <= 0) {
      throw new Error("baseOutcomePrice must be greater than zero");
    }

    if (audience.verifiedLtv <= 0) {
      throw new Error("audience.verifiedLtv must be greater than zero");
    }

    const marketPressure = request.marketPressure ?? 1;
    const recencyMultiplier = audience.recencyMultiplier ?? 1;
    const attentionScore = audience.attentionScore ?? 0.5;
    const riskTolerance = request.riskTolerance ?? 0.3;

    const ltvMultiplier = clamp(
      1 + ((audience.verifiedLtv / baseOutcomePrice) - 1) * 0.35,
      0.75,
      2.75
    );
    // BUG FIX: Original had clamp(0.7, 1.6, value) - args were swapped
    const confidenceMultiplier = clamp(
      0.7 + ((audience.intentScore + audience.conversionRate) / 2) * recencyMultiplier,
      0.7,
      1.6
    );
    const attentionMultiplier = clamp(0.6 + attentionScore * 1.2, 0.6, 1.8);
    const marketMultiplier = clamp(marketPressure, 0.8, 1.4);
    const riskMultiplier = clamp(1 - riskTolerance * 0.2, 0.75, 1);

    const rawBid =
      baseOutcomePrice *
      ltvMultiplier *
      confidenceMultiplier *
      attentionMultiplier *
      marketMultiplier *
      riskMultiplier;
    const floorPrice = request.floorPrice ?? baseOutcomePrice * 0.85;
    const maxPrice = request.maxPrice ?? baseOutcomePrice * 3;
    const finalBid = roundCurrency(clamp(rawBid, floorPrice, maxPrice));

    return {
      finalBid,
      pricingModel: "outcome-based",
      breakdown: {
        baseOutcomePrice: roundCurrency(baseOutcomePrice),
        ltvMultiplier: Number(ltvMultiplier.toFixed(3)),
        confidenceMultiplier: Number(confidenceMultiplier.toFixed(3)),
        attentionMultiplier: Number(attentionMultiplier.toFixed(3)),
        marketMultiplier: Number(marketMultiplier.toFixed(3)),
        riskMultiplier: Number(riskMultiplier.toFixed(3))
      }
    };
  }
}
