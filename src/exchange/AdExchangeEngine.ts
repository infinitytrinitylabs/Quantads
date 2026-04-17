import { randomUUID } from "node:crypto";
import { BiddingEngine } from "../bidding/BiddingEngine";
import { logger } from "../lib/logger";
import { ExchangeAnalyticsStore, exchangeAnalyticsStore } from "./ExchangeAnalyticsStore";
import { FraudDetectionService } from "./FraudDetectionService";
import {
  AttentionPricingBreakdown,
  ExchangeAuctionSnapshot,
  ExchangeBidRequest,
  ExchangeBidResponse,
  ExchangeEngineConfig,
  RankedExchangeBid
} from "./types";
import { clamp, nowIso, round } from "./math";

interface StoredBidEntry {
  request: ExchangeBidRequest;
  response: ExchangeBidResponse;
  acceptedAt: string;
}

const DEFAULT_CONFIG: ExchangeEngineConfig = {
  minimumTrustedTrafficScore: 0.35,
  suspiciousTrafficThreshold: 0.52,
  blockedTrafficThreshold: 0.86,
  secondPriceIncrement: 0.01,
  maxLeaderboardSize: 10,
  liveAuctionLimit: 20
};

export class AdExchangeEngine {
  private readonly pricingEngine = new BiddingEngine();
  private readonly fraudDetection = new FraudDetectionService();
  private readonly auctions = new Map<string, StoredBidEntry[]>();
  private readonly config: ExchangeEngineConfig;

  constructor(
    private readonly analyticsStore: ExchangeAnalyticsStore = exchangeAnalyticsStore,
    config?: Partial<ExchangeEngineConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  submitBid(request: ExchangeBidRequest): ExchangeBidResponse {
    const requestId = request.requestId ?? randomUUID();
    const occurredAt = request.occurredAt ?? nowIso();
    const normalizedRequest: ExchangeBidRequest = {
      ...request,
      requestId,
      occurredAt,
      pricingCurrency: request.pricingCurrency ?? "USDC"
    };

    const fraudAssessment = this.fraudDetection.assess(normalizedRequest);
    const pricing = this.calculatePricing(normalizedRequest, fraudAssessment.trustedTrafficScore);
    const reservePrice = round(normalizedRequest.placement.reservePrice ?? normalizedRequest.placement.floorPrice, 4);
    const settledAsRejected =
      fraudAssessment.decision === "rejected" ||
      fraudAssessment.combinedScore >= this.config.blockedTrafficThreshold ||
      fraudAssessment.trustedTrafficScore < this.config.minimumTrustedTrafficScore;

    const provisionalResponse: ExchangeBidResponse = {
      requestId,
      auctionId: normalizedRequest.placement.auctionId,
      slotId: normalizedRequest.placement.slotId,
      advertiserId: normalizedRequest.advertiserId,
      campaignId: normalizedRequest.placement.campaignId,
      creativeId: normalizedRequest.creativeId,
      status: settledAsRejected ? "rejected" : fraudAssessment.decision,
      settlementStatus: settledAsRejected ? "rejected" : "leading",
      finalBid: pricing.finalBid,
      rankedBid: round(pricing.finalBid * pricing.attentionMultiplier * pricing.trustMultiplier * pricing.qualityMultiplier, 4),
      clearingPrice: null,
      reservePrice,
      rank: null,
      isWinner: false,
      secondPrice: null,
      priceToBeat: null,
      pricing,
      diagnostics: fraudAssessment,
      leaderboard: []
    };

    const auctionKey = this.auctionKey(normalizedRequest.placement.auctionId, normalizedRequest.placement.slotId);
    const entries = this.auctions.get(auctionKey) ?? [];

    if (!settledAsRejected) {
      entries.push({
        request: normalizedRequest,
        response: provisionalResponse,
        acceptedAt: occurredAt
      });
      this.auctions.set(auctionKey, entries);
      this.recomputeAuction(entries, reservePrice);
    }

    const response = settledAsRejected
      ? provisionalResponse
      : entries.find((entry) => entry.response.requestId === requestId)?.response ?? provisionalResponse;
    const snapshot = this.getAuctionSnapshot(normalizedRequest.placement.auctionId, normalizedRequest.placement.slotId);

    if (response.status === "rejected") {
      logger.warn(
        {
          advertiserId: normalizedRequest.advertiserId,
          requestId,
          fraudScore: fraudAssessment.combinedScore,
          slotId: normalizedRequest.placement.slotId,
          auctionId: normalizedRequest.placement.auctionId
        },
        "exchange bid rejected"
      );
    } else {
      logger.info(
        {
          advertiserId: normalizedRequest.advertiserId,
          requestId,
          rankedBid: response.rankedBid,
          slotId: normalizedRequest.placement.slotId,
          auctionId: normalizedRequest.placement.auctionId,
          isWinner: response.isWinner
        },
        "exchange bid processed"
      );
    }

    this.analyticsStore.recordBid(normalizedRequest, response, snapshot);
    return response;
  }

  getAuctionSnapshot(auctionId: string, slotId: string): ExchangeAuctionSnapshot {
    const entries = this.auctions.get(this.auctionKey(auctionId, slotId)) ?? [];
    const leaderboard = entries
      .map((entry) => this.toRankedBid(entry.response))
      .sort((left, right) => right.rankedBid - left.rankedBid || right.finalBid - left.finalBid || left.submittedAt.localeCompare(right.submittedAt));
    const winner = leaderboard.find((entry) => entry.settlementStatus === "won") ?? null;
    const secondPrice = winner?.clearingPrice ?? null;

    return {
      auctionId,
      slotId,
      campaignId: entries[0]?.request.placement.campaignId ?? "unknown",
      reservePrice: entries[0]?.response.reservePrice ?? 0,
      requestedAt: entries[0]?.acceptedAt ?? nowIso(),
      totalRequests: leaderboard.length,
      acceptedBids: leaderboard.filter((entry) => entry.status !== "rejected").length,
      rejectedBids: 0,
      winner,
      leaderboard: leaderboard.slice(0, this.config.maxLeaderboardSize),
      secondPrice,
      averageAttentionMultiplier: round(
        leaderboard.length > 0
          ? leaderboard.reduce((total, entry) => total + entry.attentionMultiplier, 0) / leaderboard.length
          : 0,
        6
      ),
      averageFraudScore: round(
        leaderboard.length > 0
          ? leaderboard.reduce((total, entry) => total + entry.fraudScore, 0) / leaderboard.length
          : 0,
        6
      )
    };
  }

  getFraudModelSnapshot(): { sampleSize: number; treeCount: number; featureLabels: string[] } {
    return this.fraudDetection.getModelSnapshot();
  }

  getFraudFeatureDrift(): Array<{ label: string; mean: number; standardDeviation: number }> {
    return this.fraudDetection.getFeatureDrift();
  }

  private calculatePricing(request: ExchangeBidRequest, trustedTrafficScore: number): AttentionPricingBreakdown {
    const bidResult = this.pricingEngine.calculateOutcomeBid({
      baseOutcomePrice: request.baseOutcomePrice,
      audience: {
        verifiedLtv: request.audience.verifiedLtv,
        intentScore: request.audience.intentScore,
        conversionRate: request.audience.conversionRate,
        recencyMultiplier: request.audience.recencyMultiplier,
        attentionScore: request.audience.attentionScore
      },
      marketPressure: request.placement.marketPressure,
      floorPrice: request.placement.floorPrice,
      maxPrice: request.bidCeiling,
      riskTolerance: clamp(1 - trustedTrafficScore, 0, 1)
    });

    const attentionScore = request.audience.attentionScore ?? 0.5;
    const attentionMultiplier = round(0.6 + attentionScore * 1.2, 6);
    const trustMultiplier = round(clamp(0.55 + trustedTrafficScore * 0.75, 0.45, 1.3), 6);
    const qualityMultiplier = round(
      clamp(
        ((request.placement.publisherQualityScore ?? 0.7) * 0.55) + ((request.placement.contentSafetyScore ?? 0.85) * 0.45),
        0.55,
        1.25
      ),
      6
    );
    const viewabilityMultiplier = round(clamp(0.7 + request.placement.viewabilityEstimate * 0.6, 0.7, 1.3), 6);
    const marketMultiplier = round(clamp(request.placement.marketPressure ?? 1, 0.8, 1.35), 6);
    const uncapped = bidResult.finalBid * attentionMultiplier * trustMultiplier * qualityMultiplier * viewabilityMultiplier * marketMultiplier;
    const ceiling = request.bidCeiling ?? request.baseOutcomePrice * 4;
    const finalBid = round(clamp(uncapped, request.placement.floorPrice, ceiling), 4);

    return {
      baseBid: round(request.baseOutcomePrice, 4),
      audienceBid: round(bidResult.finalBid, 4),
      attentionMultiplier,
      attentionPriceLift: round((attentionMultiplier - 1) * 100, 4),
      trustMultiplier,
      qualityMultiplier,
      viewabilityMultiplier,
      marketMultiplier,
      finalBid,
      cappedByCeiling: uncapped > ceiling
    };
  }

  private recomputeAuction(entries: StoredBidEntry[], reservePrice: number): void {
    const ranked = [...entries].sort((left, right) => {
      if (right.response.rankedBid !== left.response.rankedBid) {
        return right.response.rankedBid - left.response.rankedBid;
      }

      if (right.response.finalBid !== left.response.finalBid) {
        return right.response.finalBid - left.response.finalBid;
      }

      return left.acceptedAt.localeCompare(right.acceptedAt);
    });

    const highest = ranked[0];
    const runnerUp = ranked[1];
    const secondPrice = runnerUp ? round(Math.max(reservePrice, runnerUp.response.rankedBid + this.config.secondPriceIncrement), 4) : round(reservePrice, 4);

    ranked.forEach((entry, index) => {
      entry.response.rank = index + 1;
      entry.response.secondPrice = secondPrice;
      entry.response.priceToBeat = index === 0 ? null : round((highest?.response.rankedBid ?? reservePrice) + this.config.secondPriceIncrement, 4);
      entry.response.clearingPrice = null;
      entry.response.isWinner = false;
      entry.response.settlementStatus = entry.response.status === "rejected" ? "rejected" : "outbid";
    });

    if (highest) {
      highest.response.isWinner = highest.response.rankedBid >= reservePrice;
      highest.response.clearingPrice = highest.response.isWinner ? secondPrice : null;
      highest.response.settlementStatus = highest.response.isWinner ? "won" : "lost";
    }

    for (const entry of ranked.slice(1)) {
      entry.response.settlementStatus = entry.response.status === "rejected" ? "rejected" : "outbid";
    }

    const leaderboard = ranked.slice(0, this.config.maxLeaderboardSize).map((entry) => this.toRankedBid(entry.response));
    for (const entry of ranked) {
      entry.response.leaderboard = leaderboard;
    }
  }

  private toRankedBid(response: ExchangeBidResponse): RankedExchangeBid {
    return {
      requestId: response.requestId,
      advertiserId: response.advertiserId,
      campaignId: response.campaignId,
      slotId: response.slotId,
      creativeId: response.creativeId,
      submittedAt: response.requestId,
      status: response.status,
      settlementStatus: response.settlementStatus,
      finalBid: response.finalBid,
      rankedBid: response.rankedBid,
      clearingPrice: response.clearingPrice,
      reservePrice: response.reservePrice,
      attentionMultiplier: response.pricing.attentionMultiplier,
      fraudScore: response.diagnostics.combinedScore,
      trustedTrafficScore: response.diagnostics.trustedTrafficScore,
      qualityTier: response.diagnostics.tier,
      diagnostics: response.diagnostics,
      pricing: response.pricing
    };
  }

  private auctionKey(auctionId: string, slotId: string): string {
    return `${auctionId}:${slotId}`;
  }
}

export const adExchangeEngine = new AdExchangeEngine();
