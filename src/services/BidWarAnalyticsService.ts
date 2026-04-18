import { createHash } from "node:crypto";
import {
  BidStrategyObjective,
  BidStrategyOptimizationRequest,
  BidStrategyOptimizationResult,
  BiddingEngine,
  OutcomeBidRequest
} from "../bidding/BiddingEngine";
import { ExchangeAnalyticsStore, exchangeAnalyticsStore } from "../exchange/ExchangeAnalyticsStore";
import { average, bucketTimestamp, clamp, nowIso, standardDeviation } from "../exchange/math";
import { AdvertiserDashboardSnapshot, ExchangeAnalyticsEvent, ExchangeAuctionSnapshot } from "../exchange/types";

export interface BidWarMarketCandle {
  bucketStart: string;
  open: number;
  high: number;
  low: number;
  close: number;
  averageClearingPrice: number;
  averageAttentionMultiplier: number;
  averageFraudScore: number;
  volume: number;
  wins: number;
  rejections: number;
  volatility: number;
  pressureIndex: number;
}

export interface BidWarReplayEvent {
  occurredAt: string;
  auctionId: string;
  slotId: string;
  campaignId: string;
  creativeId: string;
  requestId: string;
  finalBid: number;
  rankedBid: number;
  clearingPrice: number | null;
  priceToBeat: number;
  outcomeRate: number;
  attentionScore: number;
  fraudScore: number;
  marketPressure: number;
  verifiedLtv: number;
  qualityTier: string;
  settlementStatus: string;
  wonAuction: boolean;
  rejected: boolean;
  sniperWindowScore: number;
  marginSpread: number;
}

export interface SniperModeOpportunity {
  auctionId: string;
  slotId: string;
  campaignId: string;
  currentBid: number;
  leaderBid: number;
  priceToBeat: number;
  recommendedSnipeBid: number;
  expectedClearingPrice: number;
  deltaToWin: number;
  attentionScore: number;
  fraudScore: number;
  urgency: number;
  confidence: number;
  state: "ready" | "watch" | "hold";
  rationale: string[];
}

export interface CompetitorRegressionCoefficients {
  intercept: number;
  marketPressure: number;
  attentionMultiplier: number;
  reservePrice: number;
  fraudScore: number;
  leaderGap: number;
}

export interface CompetitorRegressionSnapshot {
  competitorHandle: string;
  sampleSize: number;
  averageBid: number;
  winShare: number;
  aggressiveness: number;
  confidence: number;
  rSquared: number;
  predictedNextBid: number;
  recentTrend: "ramping" | "steady" | "retreating";
  coefficients: CompetitorRegressionCoefficients;
  regressionWindow: {
    averageMarketPressure: number;
    averageAttentionMultiplier: number;
    averageReservePrice: number;
    averageLeaderGap: number;
  };
}

export interface StrategyRecommendationCard {
  auctionId: string;
  campaignId: string;
  objective: BidStrategyObjective;
  recommendedBid: number;
  currentBid: number;
  confidence: number;
  aggressionIndex: number;
  efficiencyIndex: number;
  sniperReady: boolean;
  reasoning: string[];
  guardrails: BidStrategyOptimizationResult["guardrails"];
}

export interface BidWarPulse {
  averagePressureIndex: number;
  averageVolatility: number;
  averageMarginSpread: number;
  sniperReadinessRate: number;
  bestWindowAt: string | null;
  highestBid: number;
  lowestBid: number;
}

export interface BidWarDashboardSnapshot {
  advertiserId: string;
  generatedAt: string;
  granularity: "minute" | "hour";
  summary: AdvertiserDashboardSnapshot["summary"];
  candles: BidWarMarketCandle[];
  pulse: BidWarPulse;
  sniperMode: {
    opportunities: SniperModeOpportunity[];
    bestOpportunity: SniperModeOpportunity | null;
    defaultPreset: SniperModeRequest;
  };
  competitorIntelligence: CompetitorRegressionSnapshot[];
  strategyAI: StrategyRecommendationCard[];
  replay: BidWarReplayEvent[];
  liveAuctions: ExchangeAuctionSnapshot[];
}

export interface SniperModeRequest extends OutcomeBidRequest {
  auctionId?: string;
  maxIncrement?: number;
  aggression?: number;
  objective?: BidStrategyObjective;
}

export interface SniperModeResponse {
  advertiserId: string;
  generatedAt: string;
  request: SniperModeRequest;
  opportunity: SniperModeOpportunity | null;
  candidateCount: number;
}

export interface StrategyAiRequest extends Omit<BidStrategyOptimizationRequest, "performance"> {
  auctionId?: string;
}

interface StoredObservation {
  occurredAt: string;
  auctionId: string;
  slotId: string;
  campaignId: string;
  creativeId: string;
  requestId: string;
  finalBid: number;
  rankedBid: number;
  clearingPrice: number | null;
  priceToBeat: number;
  reservePrice: number;
  attentionScore: number;
  attentionMultiplier: number;
  fraudScore: number;
  marketPressure: number;
  verifiedLtv: number;
  intentScore: number;
  conversionRate: number;
  qualityTier: string;
  settlementStatus: string;
  wonAuction: boolean;
  rejected: boolean;
  outcomeRate: number;
  marginSpread: number;
  sniperWindowScore: number;
}

interface CompetitorSample {
  bid: number;
  marketPressure: number;
  attentionMultiplier: number;
  reservePrice: number;
  fraudScore: number;
  leaderGap: number;
  won: boolean;
}

const MAX_OBSERVATIONS_PER_ADVERTISER = 4000;
const MAX_COMPETITOR_SAMPLES = 1200;
const DEFAULT_CANDLE_LIMIT = 48;
const DEFAULT_REPLAY_LIMIT = 80;

const roundCurrency = (value: number): number => Number(value.toFixed(2));
const roundMetric = (value: number, digits = 4): number => Number(value.toFixed(digits));

const pseudonymizeCompetitor = (advertiserId: string): string => {
  const digest = createHash("sha1").update(advertiserId).digest("hex").slice(0, 8);
  return `cmptr_${digest}`;
};

const invertMatrix = (matrix: number[][]): number[][] | null => {
  const size = matrix.length;
  const augmented = matrix.map((row, rowIndex) => [
    ...row,
    ...Array.from({ length: size }, (_unused, columnIndex) => (rowIndex === columnIndex ? 1 : 0))
  ]);

  for (let pivotIndex = 0; pivotIndex < size; pivotIndex += 1) {
    let pivotRow = pivotIndex;
    for (let rowIndex = pivotIndex + 1; rowIndex < size; rowIndex += 1) {
      if (Math.abs(augmented[rowIndex]![pivotIndex]!) > Math.abs(augmented[pivotRow]![pivotIndex]!)) {
        pivotRow = rowIndex;
      }
    }

    if (Math.abs(augmented[pivotRow]![pivotIndex] ?? 0) < 1e-9) {
      return null;
    }

    if (pivotRow !== pivotIndex) {
      [augmented[pivotRow], augmented[pivotIndex]] = [augmented[pivotIndex]!, augmented[pivotRow]!];
    }

    const pivot = augmented[pivotIndex]![pivotIndex]!;
    for (let columnIndex = 0; columnIndex < size * 2; columnIndex += 1) {
      augmented[pivotIndex]![columnIndex] = augmented[pivotIndex]![columnIndex]! / pivot;
    }

    for (let rowIndex = 0; rowIndex < size; rowIndex += 1) {
      if (rowIndex === pivotIndex) {
        continue;
      }

      const factor = augmented[rowIndex]![pivotIndex]!;
      for (let columnIndex = 0; columnIndex < size * 2; columnIndex += 1) {
        augmented[rowIndex]![columnIndex] =
          augmented[rowIndex]![columnIndex]! - factor * augmented[pivotIndex]![columnIndex]!;
      }
    }
  }

  return augmented.map((row) => row.slice(size));
};

const multiplyMatrixVector = (matrix: number[][], vector: number[]): number[] => {
  return matrix.map((row) => row.reduce((total, value, columnIndex) => total + value * (vector[columnIndex] ?? 0), 0));
};

const fitRegression = (samples: CompetitorSample[]): {
  coefficients: CompetitorRegressionCoefficients;
  rSquared: number;
  predictedNextBid: number;
  confidence: number;
  averageBid: number;
  aggressiveness: number;
  winShare: number;
  recentTrend: CompetitorRegressionSnapshot["recentTrend"];
  regressionWindow: CompetitorRegressionSnapshot["regressionWindow"];
} => {
  if (!samples.length) {
    return {
      coefficients: {
        intercept: 0,
        marketPressure: 0,
        attentionMultiplier: 0,
        reservePrice: 0,
        fraudScore: 0,
        leaderGap: 0
      },
      rSquared: 0,
      predictedNextBid: 0,
      confidence: 0,
      averageBid: 0,
      aggressiveness: 0,
      winShare: 0,
      recentTrend: "steady",
      regressionWindow: {
        averageMarketPressure: 0,
        averageAttentionMultiplier: 0,
        averageReservePrice: 0,
        averageLeaderGap: 0
      }
    };
  }

  const features = samples.map((sample) => [
    1,
    sample.marketPressure,
    sample.attentionMultiplier,
    sample.reservePrice,
    sample.fraudScore,
    sample.leaderGap
  ]);
  const labels = samples.map((sample) => sample.bid);
  const featureCount = features[0]?.length ?? 0;
  const xtx = Array.from({ length: featureCount }, () => Array.from({ length: featureCount }, () => 0));
  const xty = Array.from({ length: featureCount }, () => 0);
  const lambda = 0.08;

  for (let rowIndex = 0; rowIndex < features.length; rowIndex += 1) {
    const featureRow = features[rowIndex]!;
    for (let i = 0; i < featureCount; i += 1) {
      xty[i] += featureRow[i]! * labels[rowIndex]!;
      for (let j = 0; j < featureCount; j += 1) {
        xtx[i]![j] += featureRow[i]! * featureRow[j]!;
      }
    }
  }

  for (let diagonalIndex = 1; diagonalIndex < featureCount; diagonalIndex += 1) {
    xtx[diagonalIndex]![diagonalIndex] += lambda;
  }

  const inverse = invertMatrix(xtx);
  const coefficientVector = inverse ? multiplyMatrixVector(inverse, xty) : Array.from({ length: featureCount }, () => 0);
  const predicted = features.map((featureRow) => featureRow.reduce((total, value, index) => total + value * (coefficientVector[index] ?? 0), 0));
  const meanLabel = average(labels);
  const ssRes = predicted.reduce((total, estimate, index) => total + (labels[index]! - estimate) ** 2, 0);
  const ssTot = labels.reduce((total, value) => total + (value - meanLabel) ** 2, 0);
  const rSquared = ssTot <= 0 ? 0 : clamp(1 - ssRes / ssTot, 0, 1);
  const recentSamples = samples.slice(-Math.min(samples.length, 12));
  const regressionWindow = {
    averageMarketPressure: roundMetric(average(recentSamples.map((sample) => sample.marketPressure)), 4),
    averageAttentionMultiplier: roundMetric(average(recentSamples.map((sample) => sample.attentionMultiplier)), 4),
    averageReservePrice: roundMetric(average(recentSamples.map((sample) => sample.reservePrice)), 4),
    averageLeaderGap: roundMetric(average(recentSamples.map((sample) => sample.leaderGap)), 4)
  };
  const nextFeatureVector = [
    1,
    regressionWindow.averageMarketPressure || 1,
    regressionWindow.averageAttentionMultiplier || 1,
    regressionWindow.averageReservePrice,
    average(recentSamples.map((sample) => sample.fraudScore)),
    regressionWindow.averageLeaderGap
  ];
  const predictedNextBid = roundCurrency(
    clamp(
      nextFeatureVector.reduce((total, value, index) => total + value * (coefficientVector[index] ?? 0), 0),
      0,
      Math.max(...labels, 1) * 1.35
    )
  );
  const recentAverageBid = average(recentSamples.map((sample) => sample.bid));
  const olderAverageBid = average(samples.slice(0, Math.max(samples.length - recentSamples.length, 1)).map((sample) => sample.bid));
  const trendDelta = recentAverageBid - olderAverageBid;
  const recentTrend = trendDelta > 0.18 ? "ramping" : trendDelta < -0.18 ? "retreating" : "steady";
  const aggressiveness = clamp(
    average(recentSamples.map((sample) => sample.bid / Math.max(sample.reservePrice, 0.01))) / 2,
    0,
    1.5
  );
  const winShare = clamp(
    recentSamples.filter((sample) => sample.won).length / Math.max(recentSamples.length, 1),
    0,
    1
  );
  const confidence = clamp(0.22 + rSquared * 0.45 + Math.min(samples.length, 40) / 80, 0.05, 0.99);

  return {
    coefficients: {
      intercept: roundMetric(coefficientVector[0] ?? 0, 6),
      marketPressure: roundMetric(coefficientVector[1] ?? 0, 6),
      attentionMultiplier: roundMetric(coefficientVector[2] ?? 0, 6),
      reservePrice: roundMetric(coefficientVector[3] ?? 0, 6),
      fraudScore: roundMetric(coefficientVector[4] ?? 0, 6),
      leaderGap: roundMetric(coefficientVector[5] ?? 0, 6)
    },
    rSquared: roundMetric(rSquared, 4),
    predictedNextBid,
    confidence: roundMetric(confidence, 4),
    averageBid: roundCurrency(average(labels)),
    aggressiveness: roundMetric(aggressiveness, 4),
    winShare: roundMetric(winShare, 4),
    recentTrend,
    regressionWindow
  };
};

export class BidWarAnalyticsService {
  private readonly observationsByAdvertiser = new Map<string, StoredObservation[]>();
  private readonly competitorSamplesByAdvertiser = new Map<string, Map<string, CompetitorSample[]>>();

  constructor(
    private readonly store: ExchangeAnalyticsStore = exchangeAnalyticsStore,
    private readonly biddingEngine: BiddingEngine = new BiddingEngine()
  ) {
    this.store.subscribe((snapshot, event) => {
      this.ingest(snapshot.advertiserId, event);
    });
  }

  getDashboard(
    advertiserId: string,
    options?: {
      granularity?: "minute" | "hour";
      candleLimit?: number;
      replayLimit?: number;
    }
  ): BidWarDashboardSnapshot {
    const granularity = options?.granularity ?? "minute";
    const candleLimit = options?.candleLimit ?? DEFAULT_CANDLE_LIMIT;
    const replayLimit = options?.replayLimit ?? DEFAULT_REPLAY_LIMIT;
    const dashboard = this.store.getAdvertiserDashboard({ advertiserId, granularity, limit: 120 });
    const liveAuctions = this.store.listLiveAuctions({ advertiserId, limit: 20 });
    const observations = this.getObservations(advertiserId);
    const candles = this.buildCandles(observations, granularity).slice(-candleLimit);
    const replay = observations
      .slice(-replayLimit)
      .reverse()
      .map((observation) => this.toReplayEvent(observation));
    const sniperOpportunities = this.buildSniperOpportunities(advertiserId, liveAuctions, observations);
    const strategyAI = this.buildStrategyCards(advertiserId, liveAuctions, observations);

    return {
      advertiserId,
      generatedAt: nowIso(),
      granularity,
      summary: dashboard.summary,
      candles,
      pulse: this.buildPulse(candles, observations, sniperOpportunities),
      sniperMode: {
        opportunities: sniperOpportunities,
        bestOpportunity: sniperOpportunities[0] ?? null,
        defaultPreset: this.buildDefaultSniperPreset(observations, sniperOpportunities[0] ?? null)
      },
      competitorIntelligence: this.buildCompetitorIntelligence(advertiserId),
      strategyAI,
      replay,
      liveAuctions
    };
  }

  evaluateSniperMode(advertiserId: string, request: SniperModeRequest): SniperModeResponse {
    const snapshot = this.getDashboard(advertiserId, { granularity: "minute", candleLimit: 60, replayLimit: 60 });
    const targetOpportunity = request.auctionId
      ? snapshot.sniperMode.opportunities.find((opportunity) => opportunity.auctionId === request.auctionId) ?? null
      : snapshot.sniperMode.bestOpportunity;

    if (!targetOpportunity) {
      return {
        advertiserId,
        generatedAt: nowIso(),
        request,
        opportunity: null,
        candidateCount: snapshot.sniperMode.opportunities.length
      };
    }

    const aggression = clamp(request.aggression ?? 0.55, 0, 1);
    const maxIncrement = request.maxIncrement ?? Math.max(request.baseOutcomePrice * 0.25, 0.5);
    const boostedBid = clamp(
      Math.max(targetOpportunity.priceToBeat, targetOpportunity.currentBid) + aggression * maxIncrement,
      request.floorPrice ?? request.baseOutcomePrice * 0.85,
      request.maxPrice ?? request.baseOutcomePrice * 3
    );

    const refinedOpportunity: SniperModeOpportunity = {
      ...targetOpportunity,
      recommendedSnipeBid: roundCurrency(boostedBid),
      confidence: roundMetric(clamp(targetOpportunity.confidence + aggression * 0.08, 0, 0.99), 4),
      urgency: roundMetric(clamp(targetOpportunity.urgency + aggression * 0.05, 0, 1), 4),
      state: boostedBid >= targetOpportunity.priceToBeat ? "ready" : targetOpportunity.state,
      rationale: [
        ...targetOpportunity.rationale,
        `Sniper override adds ${(aggression * 100).toFixed(0)}% aggression with a max increment of $${maxIncrement.toFixed(2)}.`
      ]
    };

    return {
      advertiserId,
      generatedAt: nowIso(),
      request,
      opportunity: refinedOpportunity,
      candidateCount: snapshot.sniperMode.opportunities.length
    };
  }

  optimizeStrategy(advertiserId: string, request: StrategyAiRequest): BidStrategyOptimizationResult {
    const observations = this.getObservations(advertiserId);
    const performance = this.buildPerformanceWindow(observations, request.marketPressure ?? 1);
    const competitionIndex =
      request.competitionIndex ??
      clamp(average(this.buildCompetitorIntelligence(advertiserId).map((item) => item.aggressiveness)) / 1.2, 0, 1.4);
    const baseRequest: BidStrategyOptimizationRequest = {
      ...request,
      competitionIndex,
      performance
    };

    return this.biddingEngine.optimizeBidStrategy(baseRequest);
  }

  private ingest(advertiserId: string, event: ExchangeAnalyticsEvent): void {
    const liveAuctions = this.store.listLiveAuctions({ advertiserId, limit: 40 });
    const auctionSnapshot = liveAuctions.find((auction) => auction.auctionId === event.auctionId && auction.slotId === event.slotId);
    const advertiserEntry = auctionSnapshot?.leaderboard.find((entry) => entry.requestId === event.requestId || entry.advertiserId === advertiserId);
    const winningEntry = auctionSnapshot?.leaderboard[0] ?? null;
    const observations = this.observationsByAdvertiser.get(advertiserId) ?? [];
    const priceToBeat = roundCurrency(
      Math.max(
        advertiserEntry && winningEntry && advertiserEntry.requestId !== winningEntry.requestId
          ? winningEntry.rankedBid + 0.01
          : auctionSnapshot?.secondPrice ?? event.payload.clearingPrice ?? event.payload.bidAmount,
        auctionSnapshot?.reservePrice ?? 0,
        0
      )
    );
    const marginSpread = roundMetric((event.payload.estimatedOutcomeRate * event.payload.attentionScore * 10) - event.payload.bidAmount, 4);
    const sniperWindowScore = clamp(
      0.34 * clamp(1 - (priceToBeat - event.payload.bidAmount) / Math.max(event.payload.bidAmount, 1), 0, 1) +
        0.26 * clamp(event.payload.attentionScore, 0, 1) +
        0.18 * clamp(event.payload.marketPressure / 1.5, 0, 1) +
        0.22 * clamp(1 - event.payload.fraudScore, 0, 1),
      0,
      1
    );

    observations.push({
      occurredAt: event.occurredAt,
      auctionId: event.auctionId,
      slotId: event.slotId,
      campaignId: event.campaignId,
      creativeId: event.creativeId,
      requestId: event.requestId,
      finalBid: event.payload.bidAmount,
      rankedBid: event.payload.rankedBid,
      clearingPrice: event.payload.clearingPrice,
      priceToBeat,
      reservePrice: auctionSnapshot?.reservePrice ?? 0,
      attentionScore: event.payload.attentionScore,
      attentionMultiplier: event.payload.attentionMultiplier,
      fraudScore: event.payload.fraudScore,
      marketPressure: event.payload.marketPressure,
      verifiedLtv: event.payload.bidAmount > 0 ? event.payload.bidAmount / Math.max(event.payload.estimatedOutcomeRate, 0.01) : 0,
      intentScore: clamp(event.payload.attentionScore * 0.85 + event.payload.viewabilityEstimate * 0.15, 0, 1),
      conversionRate: clamp(event.payload.estimatedOutcomeRate, 0, 1),
      qualityTier: event.payload.qualityTier,
      settlementStatus: event.payload.wonAuction ? "won" : event.payload.rejected ? "rejected" : "outbid",
      wonAuction: event.payload.wonAuction,
      rejected: event.payload.rejected,
      outcomeRate: event.payload.estimatedOutcomeRate,
      marginSpread,
      sniperWindowScore: roundMetric(sniperWindowScore, 4)
    });

    if (observations.length > MAX_OBSERVATIONS_PER_ADVERTISER) {
      observations.splice(0, observations.length - MAX_OBSERVATIONS_PER_ADVERTISER);
    }
    this.observationsByAdvertiser.set(advertiserId, observations);

    if (!auctionSnapshot) {
      return;
    }

    const competitorMap = this.competitorSamplesByAdvertiser.get(advertiserId) ?? new Map<string, CompetitorSample[]>();
    const leaderBid = auctionSnapshot.leaderboard[0]?.rankedBid ?? 0;

    for (const entry of auctionSnapshot.leaderboard) {
      if (entry.advertiserId === advertiserId) {
        continue;
      }

      const handle = pseudonymizeCompetitor(entry.advertiserId);
      const list = competitorMap.get(handle) ?? [];
      list.push({
        bid: entry.rankedBid,
        marketPressure: event.payload.marketPressure,
        attentionMultiplier: entry.attentionMultiplier,
        reservePrice: auctionSnapshot.reservePrice,
        fraudScore: entry.fraudScore,
        leaderGap: roundMetric(Math.max(leaderBid - entry.rankedBid, 0), 4),
        won: entry.settlementStatus === "won"
      });
      if (list.length > MAX_COMPETITOR_SAMPLES) {
        list.splice(0, list.length - MAX_COMPETITOR_SAMPLES);
      }
      competitorMap.set(handle, list);
    }

    this.competitorSamplesByAdvertiser.set(advertiserId, competitorMap);
  }

  private getObservations(advertiserId: string): StoredObservation[] {
    return [...(this.observationsByAdvertiser.get(advertiserId) ?? [])].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  }

  private buildCandles(observations: StoredObservation[], granularity: "minute" | "hour"): BidWarMarketCandle[] {
    const buckets = new Map<string, StoredObservation[]>();

    for (const observation of observations) {
      const bucket = bucketTimestamp(observation.occurredAt, granularity);
      const list = buckets.get(bucket) ?? [];
      list.push(observation);
      buckets.set(bucket, list);
    }

    return [...buckets.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([bucketStart, bucketObservations]) => {
        const ordered = [...bucketObservations].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
        const rankedBids = ordered.map((observation) => observation.rankedBid);
        const clearingPrices = ordered.map((observation) => observation.clearingPrice ?? observation.finalBid);
        const volatility = standardDeviation(rankedBids);
        const pressureIndex = clamp(
          average(ordered.map((observation) => observation.marketPressure)) * 0.45 +
            average(ordered.map((observation) => observation.sniperWindowScore)) * 0.55,
          0,
          2
        );

        return {
          bucketStart,
          open: roundCurrency(ordered[0]?.rankedBid ?? 0),
          high: roundCurrency(Math.max(...rankedBids, 0)),
          low: roundCurrency(Math.min(...rankedBids, 0)),
          close: roundCurrency(ordered[ordered.length - 1]?.rankedBid ?? 0),
          averageClearingPrice: roundCurrency(average(clearingPrices)),
          averageAttentionMultiplier: roundMetric(average(ordered.map((observation) => observation.attentionMultiplier)), 4),
          averageFraudScore: roundMetric(average(ordered.map((observation) => observation.fraudScore)), 4),
          volume: ordered.length,
          wins: ordered.filter((observation) => observation.wonAuction).length,
          rejections: ordered.filter((observation) => observation.rejected).length,
          volatility: roundMetric(volatility, 4),
          pressureIndex: roundMetric(pressureIndex, 4)
        };
      });
  }

  private buildPulse(
    candles: BidWarMarketCandle[],
    observations: StoredObservation[],
    opportunities: SniperModeOpportunity[]
  ): BidWarPulse {
    const sniperReadinessRate = opportunities.length
      ? opportunities.filter((opportunity) => opportunity.state === "ready").length / opportunities.length
      : 0;

    return {
      averagePressureIndex: roundMetric(average(candles.map((candle) => candle.pressureIndex)), 4),
      averageVolatility: roundMetric(average(candles.map((candle) => candle.volatility)), 4),
      averageMarginSpread: roundMetric(average(observations.map((observation) => observation.marginSpread)), 4),
      sniperReadinessRate: roundMetric(sniperReadinessRate, 4),
      bestWindowAt: opportunities[0]?.auctionId ?? null,
      highestBid: roundCurrency(Math.max(...observations.map((observation) => observation.rankedBid), 0)),
      lowestBid: roundCurrency(
        observations.length ? Math.min(...observations.map((observation) => observation.rankedBid)) : 0
      )
    };
  }

  private buildSniperOpportunities(
    advertiserId: string,
    liveAuctions: ExchangeAuctionSnapshot[],
    observations: StoredObservation[]
  ): SniperModeOpportunity[] {
    const recentPerformance = this.buildPerformanceWindow(observations, average(observations.map((item) => item.marketPressure)) || 1);

    return liveAuctions
      .map((auction) => {
        const selfEntry = auction.leaderboard.find((entry) => entry.advertiserId === advertiserId);
        if (!selfEntry) {
          return null;
        }

        const leader = auction.leaderboard[0] ?? selfEntry;
        const priceToBeat = roundCurrency(
          leader.advertiserId === advertiserId ? Math.max(auction.secondPrice ?? selfEntry.finalBid, auction.reservePrice) : leader.rankedBid + 0.01
        );
        const deltaToWin = roundCurrency(Math.max(priceToBeat - selfEntry.rankedBid, 0));
        const optimization = this.biddingEngine.optimizeBidStrategy({
          baseOutcomePrice: Math.max(selfEntry.clearingPrice ?? selfEntry.finalBid, 1),
          audience: {
            verifiedLtv: Math.max(average(observations.map((observation) => observation.verifiedLtv)), selfEntry.finalBid * 4),
            intentScore: clamp(average(observations.map((observation) => observation.intentScore)), 0.1, 1),
            conversionRate: clamp(average(observations.map((observation) => observation.conversionRate)), 0.01, 1),
            attentionScore: clamp(average(observations.map((observation) => observation.attentionScore)), 0.05, 1),
            recencyMultiplier: 1.05
          },
          floorPrice: auction.reservePrice,
          maxPrice: Math.max(selfEntry.finalBid * 1.5, priceToBeat + 1.5),
          marketPressure: clamp(auction.averageAttentionMultiplier * 0.35 + recentPerformance.marketPressure * 0.65, 0.8, 1.6),
          riskTolerance: clamp(0.42 - recentPerformance.suspiciousTrafficRate * 0.25, 0.1, 0.85),
          competitionIndex: clamp((auction.leaderboard.length - 1) / 6 + deltaToWin / Math.max(selfEntry.finalBid, 1), 0, 1.5),
          sniperMode: true,
          objective: "sniper",
          performance: recentPerformance
        });
        const confidence = clamp(
          optimization.confidence * 0.65 + (1 - selfEntry.fraudScore) * 0.2 + (selfEntry.attentionMultiplier / 1.8) * 0.15,
          0,
          0.99
        );
        const urgency = clamp(
          0.35 + deltaToWin / Math.max(priceToBeat, 1) * 0.2 + (leader.advertiserId === advertiserId ? 0 : 0.25) + auction.averageAttentionMultiplier * 0.1,
          0,
          1
        );
        const recommendedSnipeBid = roundCurrency(
          clamp(
            Math.max(priceToBeat, optimization.recommendedBid),
            auction.reservePrice,
            optimization.guardrails.maxPrice
          )
        );
        const state: SniperModeOpportunity["state"] =
          selfEntry.fraudScore >= 0.65
            ? "hold"
            : recommendedSnipeBid >= priceToBeat && confidence >= 0.45
            ? "ready"
            : "watch";

        return {
          auctionId: auction.auctionId,
          slotId: auction.slotId,
          campaignId: auction.campaignId,
          currentBid: roundCurrency(selfEntry.finalBid),
          leaderBid: roundCurrency(leader.finalBid),
          priceToBeat,
          recommendedSnipeBid,
          expectedClearingPrice: roundCurrency(auction.secondPrice ?? leader.clearingPrice ?? leader.finalBid),
          deltaToWin,
          attentionScore: roundMetric(clamp(selfEntry.attentionMultiplier / 1.8, 0, 1), 4),
          fraudScore: roundMetric(selfEntry.fraudScore, 4),
          urgency: roundMetric(urgency, 4),
          confidence: roundMetric(confidence, 4),
          state,
          rationale: [
            `Auction ${auction.auctionId} needs $${deltaToWin.toFixed(2)} to clear the current leader.`,
            `Attention multiplier ${selfEntry.attentionMultiplier.toFixed(3)} and fraud score ${selfEntry.fraudScore.toFixed(3)} drive the window score.`,
            `BidStrategyAI produced a sniper recommendation of $${optimization.recommendedBid.toFixed(2)} with confidence ${(optimization.confidence * 100).toFixed(0)}%.`
          ]
        };
      })
      .filter((opportunity): opportunity is SniperModeOpportunity => opportunity !== null)
      .sort((left, right) => right.confidence - left.confidence || right.urgency - left.urgency)
      .slice(0, 8);
  }

  private buildCompetitorIntelligence(advertiserId: string): CompetitorRegressionSnapshot[] {
    const competitorMap = this.competitorSamplesByAdvertiser.get(advertiserId) ?? new Map<string, CompetitorSample[]>();

    return [...competitorMap.entries()]
      .map(([competitorHandle, samples]) => {
        const regression = fitRegression(samples);
        return {
          competitorHandle,
          sampleSize: samples.length,
          averageBid: regression.averageBid,
          winShare: regression.winShare,
          aggressiveness: regression.aggressiveness,
          confidence: regression.confidence,
          rSquared: regression.rSquared,
          predictedNextBid: regression.predictedNextBid,
          recentTrend: regression.recentTrend,
          coefficients: regression.coefficients,
          regressionWindow: regression.regressionWindow
        };
      })
      .filter((entry) => entry.sampleSize >= 2)
      .sort((left, right) => right.confidence - left.confidence || right.predictedNextBid - left.predictedNextBid)
      .slice(0, 8);
  }

  private buildStrategyCards(
    advertiserId: string,
    liveAuctions: ExchangeAuctionSnapshot[],
    observations: StoredObservation[]
  ): StrategyRecommendationCard[] {
    const performance = this.buildPerformanceWindow(observations, average(observations.map((observation) => observation.marketPressure)) || 1);
    const competitorIntel = this.buildCompetitorIntelligence(advertiserId);
    const competitionIndex = clamp(average(competitorIntel.map((entry) => entry.aggressiveness)) / 1.15, 0, 1.4);

    return liveAuctions
      .map((auction, index) => {
        const selfEntry = auction.leaderboard.find((entry) => entry.advertiserId === advertiserId);
        if (!selfEntry) {
          return null;
        }

        const optimization = this.biddingEngine.optimizeBidStrategy({
          baseOutcomePrice: Math.max(selfEntry.clearingPrice ?? selfEntry.finalBid, 1),
          audience: {
            verifiedLtv: Math.max(average(observations.map((observation) => observation.verifiedLtv)), selfEntry.finalBid * 5),
            intentScore: clamp(average(observations.map((observation) => observation.intentScore)), 0.1, 1),
            conversionRate: clamp(average(observations.map((observation) => observation.conversionRate)), 0.01, 1),
            attentionScore: clamp(selfEntry.attentionMultiplier / 1.8, 0, 1),
            recencyMultiplier: 1.05
          },
          floorPrice: auction.reservePrice,
          maxPrice: Math.max((auction.leaderboard[0]?.rankedBid ?? selfEntry.finalBid) * 1.35, selfEntry.finalBid * 1.2),
          marketPressure: clamp(auction.averageAttentionMultiplier * 0.3 + performance.marketPressure * 0.7, 0.8, 1.6),
          riskTolerance: clamp(0.28 + index * 0.03, 0.15, 0.75),
          competitionIndex,
          sniperMode: index === 0,
          objective: index === 0 ? "sniper" : performance.recentWinRate < 0.35 ? "scale-wins" : "defend-margin",
          performance
        });

        return {
          auctionId: auction.auctionId,
          campaignId: auction.campaignId,
          objective: optimization.objective,
          recommendedBid: optimization.recommendedBid,
          currentBid: roundCurrency(selfEntry.finalBid),
          confidence: optimization.confidence,
          aggressionIndex: optimization.aggressionIndex,
          efficiencyIndex: optimization.efficiencyIndex,
          sniperReady: optimization.sniperReady,
          reasoning: optimization.reasoning,
          guardrails: optimization.guardrails
        };
      })
      .filter((entry): entry is StrategyRecommendationCard => entry !== null)
      .sort((left, right) => right.confidence - left.confidence || right.recommendedBid - left.recommendedBid)
      .slice(0, 8);
  }

  private buildPerformanceWindow(
    observations: StoredObservation[],
    marketPressure: number
  ): BidStrategyOptimizationRequest["performance"] {
    const recent = observations.slice(-Math.min(observations.length, 24));
    const wins = recent.filter((observation) => observation.wonAuction).length;
    const accepted = recent.filter((observation) => !observation.rejected).length;
    const spendVelocity = average(recent.map((observation) => observation.finalBid));
    const historicalWinRate = observations.length
      ? observations.filter((item) => item.wonAuction).length / Math.max(observations.filter((item) => !item.rejected).length, 1)
      : 0;
    const winLossSwing = recent.length >= 2 ? clamp((wins / Math.max(accepted, 1)) - historicalWinRate, -1, 1) : 0;
    const clearingPrices = recent.map((observation) => observation.clearingPrice ?? observation.finalBid);

    return {
      recentWinRate: roundMetric(accepted ? wins / accepted : 0, 4),
      averageClearingPrice: roundCurrency(average(clearingPrices)),
      spendVelocity: roundMetric(spendVelocity, 4),
      winLossSwing: roundMetric(winLossSwing, 4),
      suspiciousTrafficRate: roundMetric(recent.length ? recent.filter((item) => item.fraudScore >= 0.52).length / recent.length : 0, 4),
      averageAttentionScore: roundMetric(average(recent.map((observation) => observation.attentionScore)), 4),
      marketPressure: roundMetric(marketPressure, 4),
      recentConversions: roundMetric(recent.reduce((total, observation) => total + observation.outcomeRate * 10, 0), 4),
      budgetRemainingRatio: roundMetric(clamp(1 - spendVelocity / Math.max(average(clearingPrices) * 4 + 1, 1), 0, 1), 4),
      targetCpa: roundCurrency(average(clearingPrices) * 0.9)
    };
  }

  private buildDefaultSniperPreset(
    observations: StoredObservation[],
    bestOpportunity: SniperModeOpportunity | null
  ): SniperModeRequest {
    return {
      auctionId: bestOpportunity?.auctionId,
      baseOutcomePrice: Math.max(average(observations.map((observation) => observation.clearingPrice ?? observation.finalBid)), 1),
      audience: {
        verifiedLtv: Math.max(average(observations.map((observation) => observation.verifiedLtv)), 10),
        intentScore: clamp(average(observations.map((observation) => observation.intentScore)), 0.1, 1),
        conversionRate: clamp(average(observations.map((observation) => observation.conversionRate)), 0.01, 1),
        attentionScore: clamp(average(observations.map((observation) => observation.attentionScore)), 0.05, 1),
        recencyMultiplier: 1.05
      },
      marketPressure: clamp(average(observations.map((observation) => observation.marketPressure)), 0.8, 1.6),
      floorPrice: Math.max(average(observations.map((observation) => observation.reservePrice)), 0.5),
      maxPrice: Math.max(bestOpportunity?.priceToBeat ?? 0, average(observations.map((observation) => observation.finalBid)) * 1.35, 2),
      riskTolerance: 0.3,
      maxIncrement: Math.max(average(observations.map((observation) => observation.priceToBeat - observation.finalBid)), 0.35),
      aggression: bestOpportunity ? clamp(bestOpportunity.urgency, 0.25, 0.9) : 0.55,
      objective: bestOpportunity?.state === "ready" ? "sniper" : "balanced"
    };
  }

  private toReplayEvent(observation: StoredObservation): BidWarReplayEvent {
    return {
      occurredAt: observation.occurredAt,
      auctionId: observation.auctionId,
      slotId: observation.slotId,
      campaignId: observation.campaignId,
      creativeId: observation.creativeId,
      requestId: observation.requestId,
      finalBid: roundCurrency(observation.finalBid),
      rankedBid: roundCurrency(observation.rankedBid),
      clearingPrice: observation.clearingPrice === null ? null : roundCurrency(observation.clearingPrice),
      priceToBeat: roundCurrency(observation.priceToBeat),
      outcomeRate: roundMetric(observation.outcomeRate, 4),
      attentionScore: roundMetric(observation.attentionScore, 4),
      fraudScore: roundMetric(observation.fraudScore, 4),
      marketPressure: roundMetric(observation.marketPressure, 4),
      verifiedLtv: roundCurrency(observation.verifiedLtv),
      qualityTier: observation.qualityTier,
      settlementStatus: observation.settlementStatus,
      wonAuction: observation.wonAuction,
      rejected: observation.rejected,
      sniperWindowScore: roundMetric(observation.sniperWindowScore, 4),
      marginSpread: roundMetric(observation.marginSpread, 4)
    };
  }
}

export const bidWarAnalyticsService = new BidWarAnalyticsService();
