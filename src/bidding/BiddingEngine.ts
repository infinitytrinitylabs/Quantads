export interface AudienceSignal {
  verifiedLtv: number;
  intentScore: number;
  conversionRate: number;
  recencyMultiplier?: number;
  /**
   * Real-time BCI (Brain-Computer Interface) composite attention score from the
   * Quantads attention pipeline.  Range 0.0 (fully distracted) to 1.0 (fully
   * attentive).  When present, scales the effective CPC via an attention
   * multiplier [0.6, 1.8]; when absent defaults to 1.0 (backward-compatible).
   */
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

export type BidStrategyObjective = "balanced" | "scale-wins" | "defend-margin" | "sniper";

export interface BidStrategyPerformanceWindow {
  recentWinRate: number;
  averageClearingPrice: number;
  spendVelocity: number;
  winLossSwing: number;
  suspiciousTrafficRate: number;
  averageAttentionScore: number;
  marketPressure: number;
  recentConversions: number;
  budgetRemainingRatio: number;
  targetCpa?: number;
}

export interface BidStrategyOptimizationRequest extends OutcomeBidRequest {
  objective?: BidStrategyObjective;
  competitionIndex?: number;
  sniperMode?: boolean;
  marginGuardrail?: number;
  performance: BidStrategyPerformanceWindow;
}

export interface BidStrategyScenario {
  label: "cautious" | "balanced" | "aggressive";
  bid: number;
  expectedWinLift: number;
  expectedMarginEfficiency: number;
}

export interface BidStrategyOptimizationResult {
  objective: BidStrategyObjective;
  baselineBid: number;
  recommendedBid: number;
  confidence: number;
  aggressionIndex: number;
  efficiencyIndex: number;
  sniperReady: boolean;
  guardrails: {
    floorPrice: number;
    maxPrice: number;
    maxIncrement: number;
    budgetThrottle: number;
    suspiciousTrafficRate: number;
  };
  reasoning: string[];
  scenarioMatrix: BidStrategyScenario[];
}

const clamp = (value: number, minimum: number, maximum: number): number => {
  if (!Number.isFinite(value)) {
    return minimum;
  }

  return Math.min(Math.max(value, minimum), maximum);
};

const roundCurrency = (value: number): number => {
  return Number(value.toFixed(2));
};

const roundMetric = (value: number, digits = 4): number => {
  return Number(value.toFixed(digits));
};

const objectiveWeights: Record<
  BidStrategyObjective,
  {
    pressure: number;
    performance: number;
    margin: number;
    sniper: number;
  }
> = {
  balanced: {
    pressure: 0.32,
    performance: 0.34,
    margin: 0.2,
    sniper: 0.14
  },
  "scale-wins": {
    pressure: 0.42,
    performance: 0.36,
    margin: 0.08,
    sniper: 0.14
  },
  "defend-margin": {
    pressure: 0.16,
    performance: 0.22,
    margin: 0.48,
    sniper: 0.14
  },
  sniper: {
    pressure: 0.27,
    performance: 0.22,
    margin: 0.09,
    sniper: 0.42
  }
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
    const riskTolerance = request.riskTolerance ?? 0.3;

    const ltvMultiplier = clamp(
      1 + ((audience.verifiedLtv / baseOutcomePrice) - 1) * 0.35,
      0.75,
      2.75
    );
    const confidenceMultiplier = clamp(
      0.7 + ((audience.intentScore + audience.conversionRate) / 2) * recencyMultiplier,
      0.7,
      1.6
    );
    // BCI attention multiplier: maps [0,1] → [0.6,1.8].
    // Defaults to 1.0 when no real-time biometric signal is available
    // (backward-compatible with callers that do not supply attentionScore).
    const attentionMultiplier =
      audience.attentionScore !== undefined
        ? clamp(0.6 + audience.attentionScore * 1.2, 0.6, 1.8)
        : 1.0;
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
        ltvMultiplier: roundMetric(ltvMultiplier, 3),
        confidenceMultiplier: roundMetric(confidenceMultiplier, 3),
        attentionMultiplier: roundMetric(attentionMultiplier, 3),
        marketMultiplier: roundMetric(marketMultiplier, 3),
        riskMultiplier: roundMetric(riskMultiplier, 3)
      }
    };
  }

  optimizeBidStrategy(request: BidStrategyOptimizationRequest): BidStrategyOptimizationResult {
    const baseline = this.calculateOutcomeBid(request);
    const objective = request.objective ?? "balanced";
    const weights = objectiveWeights[objective];
    const performance = request.performance;
    const competitionIndex = clamp(request.competitionIndex ?? 0.5, 0, 1.5);
    const marginGuardrail = clamp(request.marginGuardrail ?? 0.22, 0.05, 0.9);
    const floorPrice = request.floorPrice ?? request.baseOutcomePrice * 0.85;
    const maxPrice = request.maxPrice ?? request.baseOutcomePrice * 3;
    const baselineBid = baseline.finalBid;
    const marketPressure = request.marketPressure ?? performance.marketPressure ?? 1;

    const winRateSignal = clamp(performance.recentWinRate, 0, 1);
    const attentionSignal = clamp(performance.averageAttentionScore, 0, 1);
    const conversionSignal = clamp(performance.recentConversions / 25, 0, 1);
    const trafficRisk = clamp(performance.suspiciousTrafficRate, 0, 1);
    const budgetRoom = clamp(performance.budgetRemainingRatio, 0, 1);
    const clearingGap = clamp(
      baselineBid > 0 ? (performance.averageClearingPrice - baselineBid) / baselineBid : 0,
      -1,
      1
    );
    const competitionPressure = clamp(
      (marketPressure - 1) * 0.55 + competitionIndex * 0.6 + Math.max(performance.winLossSwing, 0) * 0.4,
      0,
      1.4
    );
    const efficiencySignal = clamp(
      0.45 * winRateSignal +
        0.3 * attentionSignal +
        0.25 * conversionSignal -
        trafficRisk * 0.35 -
        Math.max(clearingGap, 0) * 0.2,
      0,
      1
    );
    const marginSignal = clamp(
      marginGuardrail + budgetRoom * 0.45 - Math.max(clearingGap, 0) * 0.25 - trafficRisk * 0.4,
      0,
      1
    );
    const sniperSignal = clamp(
      (request.sniperMode ? 0.3 : 0) + competitionPressure * 0.35 + Math.max(clearingGap, 0) * 0.2 + attentionSignal * 0.15,
      0,
      1
    );

    const aggressionIndex = clamp(
      weights.pressure * competitionPressure +
        weights.performance * efficiencySignal +
        weights.sniper * sniperSignal +
        weights.margin * (1 - marginSignal) +
        budgetRoom * 0.08,
      0.05,
      0.98
    );

    const budgetThrottle = clamp(0.55 + budgetRoom * 0.45, 0.35, 1);
    const maxIncrement = clamp(
      baselineBid * (0.08 + aggressionIndex * 0.22 + (request.sniperMode ? 0.06 : 0)),
      request.baseOutcomePrice * 0.05,
      request.baseOutcomePrice * 1.2
    );
    const riskTolerance = clamp(request.riskTolerance ?? 0.3, 0, 1);
    const upliftRatio =
      aggressionIndex * (0.22 + riskTolerance * 0.16) +
      Math.max(clearingGap, 0) * 0.35 +
      (request.sniperMode ? 0.08 : 0) -
      marginSignal * 0.12 -
      trafficRisk * 0.18;
    const downshiftRatio = trafficRisk * 0.18 + (1 - budgetRoom) * 0.14 + (objective === "defend-margin" ? 0.08 : 0);
    const proposedBid = baselineBid * (1 + upliftRatio - downshiftRatio);
    const recommendedBid = roundCurrency(
      clamp(proposedBid, floorPrice, Math.min(maxPrice, baselineBid + maxIncrement))
    );

    const confidence = clamp(
      0.35 + winRateSignal * 0.2 + attentionSignal * 0.15 + conversionSignal * 0.15 + budgetRoom * 0.08 - trafficRisk * 0.2,
      0.05,
      0.99
    );
    const efficiencyIndex = clamp(
      marginSignal * 0.45 + efficiencySignal * 0.35 + (1 - trafficRisk) * 0.2,
      0,
      1
    );

    const scenarioMatrix: BidStrategyScenario[] = [
      this.buildScenario("cautious", baselineBid, floorPrice, maxPrice, competitionPressure, efficiencyIndex, -0.08),
      this.buildScenario("balanced", recommendedBid, floorPrice, maxPrice, competitionPressure, efficiencyIndex, 0),
      this.buildScenario(
        "aggressive",
        recommendedBid + maxIncrement * 0.45,
        floorPrice,
        maxPrice,
        competitionPressure,
        efficiencyIndex,
        0.09
      )
    ];

    const reasoning = this.buildStrategyReasoning({
      objective,
      baselineBid,
      recommendedBid,
      marketPressure,
      competitionIndex,
      winRateSignal,
      attentionSignal,
      trafficRisk,
      budgetRoom,
      marginSignal,
      clearingGap,
      request
    });

    return {
      objective,
      baselineBid,
      recommendedBid,
      confidence: roundMetric(confidence, 4),
      aggressionIndex: roundMetric(aggressionIndex, 4),
      efficiencyIndex: roundMetric(efficiencyIndex, 4),
      sniperReady:
        request.sniperMode === true &&
        confidence >= 0.45 &&
        trafficRisk <= 0.45 &&
        recommendedBid >= baselineBid &&
        budgetRoom >= 0.15,
      guardrails: {
        floorPrice: roundCurrency(floorPrice),
        maxPrice: roundCurrency(maxPrice),
        maxIncrement: roundCurrency(maxIncrement),
        budgetThrottle: roundMetric(budgetThrottle, 4),
        suspiciousTrafficRate: roundMetric(trafficRisk, 4)
      },
      reasoning,
      scenarioMatrix
    };
  }

  private buildScenario(
    label: BidStrategyScenario["label"],
    bid: number,
    floorPrice: number,
    maxPrice: number,
    competitionPressure: number,
    efficiencyIndex: number,
    delta: number
  ): BidStrategyScenario {
    const boundedBid = roundCurrency(clamp(bid, floorPrice, maxPrice));
    const expectedWinLift = clamp(competitionPressure * 0.22 + 0.18 + delta, 0, 0.95);
    const expectedMarginEfficiency = clamp(efficiencyIndex + (label === "aggressive" ? -0.08 : label === "cautious" ? 0.05 : 0), 0, 1);

    return {
      label,
      bid: boundedBid,
      expectedWinLift: roundMetric(expectedWinLift, 4),
      expectedMarginEfficiency: roundMetric(expectedMarginEfficiency, 4)
    };
  }

  private buildStrategyReasoning(args: {
    objective: BidStrategyObjective;
    baselineBid: number;
    recommendedBid: number;
    marketPressure: number;
    competitionIndex: number;
    winRateSignal: number;
    attentionSignal: number;
    trafficRisk: number;
    budgetRoom: number;
    marginSignal: number;
    clearingGap: number;
    request: BidStrategyOptimizationRequest;
  }): string[] {
    const direction =
      args.recommendedBid > args.baselineBid ? "raise" : args.recommendedBid < args.baselineBid ? "trim" : "hold";
    const rationale: string[] = [
      `BidStrategyAI recommends to ${direction} from $${args.baselineBid.toFixed(2)} to $${args.recommendedBid.toFixed(2)} for ${args.objective} mode.`,
      `Verified audience LTV of $${args.request.audience.verifiedLtv.toFixed(2)} with intent ${(args.request.audience.intentScore * 100).toFixed(0)}% anchors the baseline valuation.`,
      `Market pressure is ${(args.marketPressure * 100).toFixed(0)}% of neutral and competition index is ${(args.competitionIndex * 100).toFixed(0)}%.`,
      `Recent win rate ${(args.winRateSignal * 100).toFixed(0)}%, average attention ${(args.attentionSignal * 100).toFixed(0)}%, suspicious traffic ${(args.trafficRisk * 100).toFixed(0)}%.`,
      `Budget headroom ${(args.budgetRoom * 100).toFixed(0)}% and margin guard ${(args.marginSignal * 100).toFixed(0)}% shape the max increment.`
    ];

    if (args.request.sniperMode) {
      rationale.push(
        `Sniper mode is active, so the model tolerates a tighter incremental jump when the clearing gap is ${(Math.max(args.clearingGap, 0) * 100).toFixed(1)}%.`
      );
    }

    if ((args.request.performance.targetCpa ?? 0) > 0) {
      rationale.push(
        `Target CPA is $${(args.request.performance.targetCpa ?? 0).toFixed(2)}, which is used as an efficiency backstop.`
      );
    }

    return rationale;
  }
}
