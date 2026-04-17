import {
  AdvertiserDashboardSnapshot,
  AdvertiserSummaryCard,
  AnalyticsAccumulator,
  AnalyticsQueryOptions,
  CampaignDashboardSnapshot,
  CreativePerformanceSnapshot,
  DashboardTimeGranularity,
  ExchangeAnalyticsEvent,
  ExchangeAuctionSnapshot,
  ExchangeBidRequest,
  ExchangeBidResponse,
  ExchangeEngineConfig,
  ExchangeTimeseriesPoint,
  LiveAuctionFilter,
  QualityBreakdown,
  TrafficQualityTier
} from "./types";
import { bucketTimestamp, boundedRatio, clamp, nowIso, round, unique } from "./math";

interface StoredAuctionRecord {
  snapshot: ExchangeAuctionSnapshot;
  lastUpdatedAt: string;
}

interface MutableBucket extends AnalyticsAccumulator {
  bucketStart: string;
}

const DEFAULT_ENGINE_CONFIG: ExchangeEngineConfig = {
  minimumTrustedTrafficScore: 0.35,
  suspiciousTrafficThreshold: 0.52,
  blockedTrafficThreshold: 0.86,
  secondPriceIncrement: 0.01,
  maxLeaderboardSize: 10,
  liveAuctionLimit: 20
};

const qualityTiers: TrafficQualityTier[] = ["premium", "standard", "discounted", "blocked"];

const emptyAccumulator = (): AnalyticsAccumulator => ({
  requests: 0,
  acceptedBids: 0,
  rejectedBids: 0,
  wins: 0,
  spend: 0,
  clearingSpend: 0,
  attentionScoreTotal: 0,
  fraudScoreTotal: 0,
  suspiciousTrafficCount: 0,
  botTrafficCount: 0,
  revenueProxy: 0,
  estimatedOutcomes: 0
});

const toSummaryCard = (
  advertiserId: string,
  accumulator: AnalyticsAccumulator,
  activeCampaigns: number,
  latestActivityAt: string | null
): AdvertiserSummaryCard => {
  const averageBid = accumulator.acceptedBids > 0 ? accumulator.spend / accumulator.acceptedBids : 0;
  const averageClearingPrice = accumulator.wins > 0 ? accumulator.clearingSpend / accumulator.wins : 0;
  const averageAttentionScore = accumulator.requests > 0 ? accumulator.attentionScoreTotal / accumulator.requests : 0;
  const averageFraudScore = accumulator.requests > 0 ? accumulator.fraudScoreTotal / accumulator.requests : 0;
  const suspiciousTrafficRate = accumulator.requests > 0 ? accumulator.suspiciousTrafficCount / accumulator.requests : 0;
  const botTrafficRate = accumulator.requests > 0 ? accumulator.botTrafficCount / accumulator.requests : 0;
  const winRate = accumulator.acceptedBids > 0 ? accumulator.wins / accumulator.acceptedBids : 0;
  const estimatedRoas = accumulator.clearingSpend > 0 ? accumulator.revenueProxy / accumulator.clearingSpend : 0;

  return {
    advertiserId,
    totalRequests: accumulator.requests,
    acceptedBids: accumulator.acceptedBids,
    rejectedBids: accumulator.rejectedBids,
    wins: accumulator.wins,
    totalSpend: round(accumulator.spend, 4),
    totalClearingSpend: round(accumulator.clearingSpend, 4),
    averageBid: round(averageBid, 4),
    averageClearingPrice: round(averageClearingPrice, 4),
    averageAttentionScore: round(averageAttentionScore, 6),
    averageFraudScore: round(averageFraudScore, 6),
    suspiciousTrafficRate: round(suspiciousTrafficRate, 6),
    botTrafficRate: round(botTrafficRate, 6),
    winRate: round(winRate, 6),
    estimatedOutcomes: round(accumulator.estimatedOutcomes, 4),
    estimatedRoas: round(estimatedRoas, 4),
    activeCampaigns,
    latestActivityAt
  };
};

const createBucket = (bucketStart: string): MutableBucket => ({
  bucketStart,
  ...emptyAccumulator()
});

const updateAccumulator = (
  accumulator: AnalyticsAccumulator,
  response: ExchangeBidResponse,
  request: ExchangeBidRequest
): void => {
  accumulator.requests += 1;
  accumulator.acceptedBids += response.status !== "rejected" ? 1 : 0;
  accumulator.rejectedBids += response.status === "rejected" ? 1 : 0;
  accumulator.wins += response.isWinner ? 1 : 0;
  accumulator.spend += response.status !== "rejected" ? response.finalBid : 0;
  accumulator.clearingSpend += response.isWinner ? response.clearingPrice ?? response.finalBid : 0;
  accumulator.attentionScoreTotal += request.audience.attentionScore ?? 0.5;
  accumulator.fraudScoreTotal += response.diagnostics.combinedScore;
  accumulator.suspiciousTrafficCount += response.diagnostics.suspected ? 1 : 0;
  accumulator.botTrafficCount += response.diagnostics.heuristics.suspected ? 1 : 0;
  accumulator.revenueProxy +=
    (response.clearingPrice ?? response.finalBid) * request.outcomeCount * (request.audience.verifiedLtv / Math.max(request.baseOutcomePrice, 1)) * 0.18;
  accumulator.estimatedOutcomes += request.outcomeCount * (request.audience.conversionRate * (request.audience.attentionScore ?? 0.5));
};

const accumulateQuality = (
  stats: Map<TrafficQualityTier, AnalyticsAccumulator>,
  tier: TrafficQualityTier,
  response: ExchangeBidResponse,
  request: ExchangeBidRequest
): void => {
  const existing = stats.get(tier) ?? emptyAccumulator();
  updateAccumulator(existing, response, request);
  stats.set(tier, existing);
};

const finalizeQualityBreakdown = (
  stats: Map<TrafficQualityTier, AnalyticsAccumulator>
): QualityBreakdown[] =>
  qualityTiers.map((tier) => {
    const accumulator = stats.get(tier) ?? emptyAccumulator();
    return {
      tier,
      requests: accumulator.requests,
      acceptedBids: accumulator.acceptedBids,
      rejectedBids: accumulator.rejectedBids,
      wins: accumulator.wins,
      spend: round(accumulator.spend, 4),
      averageAttentionScore: round(
        accumulator.requests > 0 ? accumulator.attentionScoreTotal / accumulator.requests : 0,
        6
      ),
      averageFraudScore: round(
        accumulator.requests > 0 ? accumulator.fraudScoreTotal / accumulator.requests : 0,
        6
      ),
      winRate: round(accumulator.acceptedBids > 0 ? accumulator.wins / accumulator.acceptedBids : 0, 6)
    };
  });

export class ExchangeAnalyticsStore {
  private readonly events: ExchangeAnalyticsEvent[] = [];
  private readonly auctions = new Map<string, StoredAuctionRecord>();
  private readonly byAdvertiser = new Map<string, AnalyticsAccumulator>();
  private readonly byAdvertiserCampaigns = new Map<string, Map<string, AnalyticsAccumulator>>();
  private readonly byAdvertiserCreatives = new Map<string, Map<string, CreativePerformanceSnapshot>>();
  private readonly qualityByAdvertiser = new Map<string, Map<TrafficQualityTier, AnalyticsAccumulator>>();
  private readonly timelineByAdvertiser = new Map<string, Map<string, MutableBucket>>();
  private readonly subscribers = new Set<(snapshot: AdvertiserDashboardSnapshot, event: ExchangeAnalyticsEvent) => void>();
  private readonly config: ExchangeEngineConfig;

  constructor(config?: Partial<ExchangeEngineConfig>) {
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...config };
  }

  recordBid(request: ExchangeBidRequest, response: ExchangeBidResponse, auctionSnapshot: ExchangeAuctionSnapshot): void {
    this.auctions.set(auctionSnapshot.auctionId, {
      snapshot: auctionSnapshot,
      lastUpdatedAt: nowIso()
    });

    const event = this.createEvent(request, response);
    this.events.push(event);
    if (this.events.length > 2000) {
      this.events.shift();
    }

    const advertiserSummary = this.byAdvertiser.get(request.advertiserId) ?? emptyAccumulator();
    updateAccumulator(advertiserSummary, response, request);
    this.byAdvertiser.set(request.advertiserId, advertiserSummary);

    const advertiserCampaigns = this.byAdvertiserCampaigns.get(request.advertiserId) ?? new Map<string, AnalyticsAccumulator>();
    const campaignSummary = advertiserCampaigns.get(request.placement.campaignId) ?? emptyAccumulator();
    updateAccumulator(campaignSummary, response, request);
    advertiserCampaigns.set(request.placement.campaignId, campaignSummary);
    this.byAdvertiserCampaigns.set(request.advertiserId, advertiserCampaigns);

    const creativeMap = this.byAdvertiserCreatives.get(request.advertiserId) ?? new Map<string, CreativePerformanceSnapshot>();
    const creative = creativeMap.get(request.creativeId) ?? {
      creativeId: request.creativeId,
      requests: 0,
      wins: 0,
      spend: 0,
      clearingSpend: 0,
      attentionScoreTotal: 0
    };
    creative.requests += 1;
    creative.wins += response.isWinner ? 1 : 0;
    creative.spend += response.status !== "rejected" ? response.finalBid : 0;
    creative.clearingSpend += response.isWinner ? response.clearingPrice ?? response.finalBid : 0;
    creative.attentionScoreTotal += request.audience.attentionScore ?? 0.5;
    creativeMap.set(request.creativeId, creative);
    this.byAdvertiserCreatives.set(request.advertiserId, creativeMap);

    const qualityMap = this.qualityByAdvertiser.get(request.advertiserId) ?? new Map<TrafficQualityTier, AnalyticsAccumulator>();
    accumulateQuality(qualityMap, response.diagnostics.tier, response, request);
    this.qualityByAdvertiser.set(request.advertiserId, qualityMap);

    this.recordTimeline(request, response);

    const snapshot = this.getAdvertiserDashboard({ advertiserId: request.advertiserId, granularity: "minute", limit: 60 });
    snapshot.lastEvent = event;
    for (const subscriber of this.subscribers) {
      subscriber(snapshot, event);
    }
  }

  getAdvertiserDashboard(options: AnalyticsQueryOptions): AdvertiserDashboardSnapshot {
    const advertiserId = options.advertiserId;
    const advertiserSummary = this.byAdvertiser.get(advertiserId) ?? emptyAccumulator();
    const campaigns = this.byAdvertiserCampaigns.get(advertiserId) ?? new Map<string, AnalyticsAccumulator>();
    const latestActivityAt = this.getLatestActivityAt(advertiserId);
    const summary = toSummaryCard(advertiserId, advertiserSummary, campaigns.size, latestActivityAt);
    const qualityBreakdown = finalizeQualityBreakdown(this.qualityByAdvertiser.get(advertiserId) ?? new Map());
    const campaignSnapshots = [...campaigns.entries()]
      .map(([campaignId, accumulator]) => this.toCampaignSnapshot(advertiserId, campaignId, accumulator, options.granularity ?? "minute", options.limit ?? 60))
      .sort((left, right) => right.summary.wins - left.summary.wins);
    const creativeMap = this.byAdvertiserCreatives.get(advertiserId) ?? new Map();
    const topCreatives = [...creativeMap.values()]
      .sort((left, right) => right.wins - left.wins || right.spend - left.spend)
      .slice(0, 8)
      .map((creative) => ({
        creativeId: creative.creativeId,
        requests: creative.requests,
        wins: creative.wins,
        spend: round(creative.spend, 4),
        clearingSpend: round(creative.clearingSpend, 4),
        winRate: round(creative.requests > 0 ? creative.wins / creative.requests : 0, 6),
        averageAttentionScore: round(creative.requests > 0 ? creative.attentionScoreTotal / creative.requests : 0, 6)
      }));

    return {
      advertiserId,
      generatedAt: nowIso(),
      granularity: options.granularity ?? "minute",
      summary,
      qualityBreakdown,
      campaignSnapshots,
      topCreatives,
      liveAuctions: this.listLiveAuctions({ advertiserId, limit: this.config.liveAuctionLimit }),
      timeline: this.getTimeline(advertiserId, options.granularity ?? "minute", options.limit ?? 60),
      lastEvent: this.getLatestEvent(advertiserId)
    };
  }

  listLiveAuctions(filter: LiveAuctionFilter): ExchangeAuctionSnapshot[] {
    return [...this.auctions.values()]
      .map((record) => record.snapshot)
      .filter((snapshot) => snapshot.leaderboard.some((entry) => entry.advertiserId === filter.advertiserId))
      .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt))
      .slice(0, filter.limit ?? this.config.liveAuctionLimit);
  }

  listRecentEvents(advertiserId: string, limit = 20): ExchangeAnalyticsEvent[] {
    return this.events
      .filter((event) => event.advertiserId === advertiserId)
      .slice(-limit)
      .reverse();
  }

  subscribe(listener: (snapshot: AdvertiserDashboardSnapshot, event: ExchangeAnalyticsEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  private recordTimeline(request: ExchangeBidRequest, response: ExchangeBidResponse): void {
    const buckets = this.timelineByAdvertiser.get(request.advertiserId) ?? new Map<string, MutableBucket>();
    const eventTime = request.occurredAt ?? nowIso();
    const minuteBucket = bucketTimestamp(eventTime, "minute");
    const bucket = buckets.get(minuteBucket) ?? createBucket(minuteBucket);
    updateAccumulator(bucket, response, request);
    buckets.set(minuteBucket, bucket);
    this.timelineByAdvertiser.set(request.advertiserId, buckets);
  }

  private getTimeline(
    advertiserId: string,
    granularity: DashboardTimeGranularity,
    limit: number
  ): ExchangeTimeseriesPoint[] {
    const minuteBuckets = this.timelineByAdvertiser.get(advertiserId) ?? new Map<string, MutableBucket>();
    const grouped = new Map<string, MutableBucket>();

    for (const bucket of minuteBuckets.values()) {
      const groupKey = bucketTimestamp(bucket.bucketStart, granularity);
      const aggregate = grouped.get(groupKey) ?? createBucket(groupKey);
      aggregate.requests += bucket.requests;
      aggregate.acceptedBids += bucket.acceptedBids;
      aggregate.rejectedBids += bucket.rejectedBids;
      aggregate.wins += bucket.wins;
      aggregate.spend += bucket.spend;
      aggregate.clearingSpend += bucket.clearingSpend;
      aggregate.attentionScoreTotal += bucket.attentionScoreTotal;
      aggregate.fraudScoreTotal += bucket.fraudScoreTotal;
      aggregate.suspiciousTrafficCount += bucket.suspiciousTrafficCount;
      aggregate.botTrafficCount += bucket.botTrafficCount;
      aggregate.revenueProxy += bucket.revenueProxy;
      aggregate.estimatedOutcomes += bucket.estimatedOutcomes;
      grouped.set(groupKey, aggregate);
    }

    return [...grouped.values()]
      .sort((left, right) => left.bucketStart.localeCompare(right.bucketStart))
      .slice(-limit)
      .map((bucket) => this.finalizeTimeseriesPoint(bucket));
  }

  private finalizeTimeseriesPoint(bucket: MutableBucket): ExchangeTimeseriesPoint {
    const averageBid = bucket.acceptedBids > 0 ? bucket.spend / bucket.acceptedBids : 0;
    const averageClearingPrice = bucket.wins > 0 ? bucket.clearingSpend / bucket.wins : 0;
    const averageAttentionScore = bucket.requests > 0 ? bucket.attentionScoreTotal / bucket.requests : 0;
    const averageFraudScore = bucket.requests > 0 ? bucket.fraudScoreTotal / bucket.requests : 0;
    const suspiciousTrafficRate = bucket.requests > 0 ? bucket.suspiciousTrafficCount / bucket.requests : 0;
    const botTrafficRate = bucket.requests > 0 ? bucket.botTrafficCount / bucket.requests : 0;
    const winRate = bucket.acceptedBids > 0 ? bucket.wins / bucket.acceptedBids : 0;
    const outcomeRateProxy = bucket.requests > 0 ? bucket.estimatedOutcomes / bucket.requests : 0;

    return {
      bucketStart: bucket.bucketStart,
      requests: bucket.requests,
      acceptedBids: bucket.acceptedBids,
      rejectedBids: bucket.rejectedBids,
      wins: bucket.wins,
      spend: round(bucket.spend, 4),
      clearingSpend: round(bucket.clearingSpend, 4),
      revenueProxy: round(bucket.revenueProxy, 4),
      averageBid: round(averageBid, 4),
      averageClearingPrice: round(averageClearingPrice, 4),
      averageAttentionScore: round(averageAttentionScore, 6),
      averageFraudScore: round(averageFraudScore, 6),
      attentionWeightedBid: round(averageAttentionScore * averageBid, 4),
      suspiciousTrafficRate: round(suspiciousTrafficRate, 6),
      botTrafficRate: round(botTrafficRate, 6),
      winRate: round(winRate, 6),
      outcomeRateProxy: round(outcomeRateProxy, 6)
    };
  }

  private toCampaignSnapshot(
    advertiserId: string,
    campaignId: string,
    accumulator: AnalyticsAccumulator,
    granularity: DashboardTimeGranularity,
    limit: number
  ): CampaignDashboardSnapshot {
    const qualityMap = new Map<TrafficQualityTier, AnalyticsAccumulator>();
    const slotIds = new Set<string>();
    const timeline = this.events
      .filter((event) => event.advertiserId === advertiserId && event.campaignId === campaignId)
      .slice(-Math.max(limit * 4, 50));

    for (const event of timeline) {
      slotIds.add(event.slotId);
      const accumulatorForTier = qualityMap.get(event.payload.qualityTier) ?? emptyAccumulator();
      accumulatorForTier.requests += 1;
      accumulatorForTier.acceptedBids += event.payload.rejected ? 0 : 1;
      accumulatorForTier.rejectedBids += event.payload.rejected ? 1 : 0;
      accumulatorForTier.wins += event.payload.wonAuction ? 1 : 0;
      accumulatorForTier.spend += event.payload.rejected ? 0 : event.payload.bidAmount;
      accumulatorForTier.clearingSpend += event.payload.wonAuction ? event.payload.clearingPrice ?? event.payload.bidAmount : 0;
      accumulatorForTier.attentionScoreTotal += event.payload.attentionScore;
      accumulatorForTier.fraudScoreTotal += event.payload.fraudScore;
      accumulatorForTier.suspiciousTrafficCount += event.payload.suspiciousTraffic ? 1 : 0;
      accumulatorForTier.botTrafficCount += event.payload.qualityTier === "blocked" ? 1 : 0;
      accumulatorForTier.revenueProxy += (event.payload.clearingPrice ?? event.payload.bidAmount) * event.payload.estimatedOutcomeRate * 5;
      accumulatorForTier.estimatedOutcomes += event.payload.estimatedOutcomeRate;
      qualityMap.set(event.payload.qualityTier, accumulatorForTier);
    }

    return {
      campaignId,
      slotIds: [...slotIds],
      summary: toSummaryCard(campaignId, accumulator, 1, timeline[timeline.length - 1]?.occurredAt ?? null),
      qualityBreakdown: finalizeQualityBreakdown(qualityMap),
      timeline: this.toTimelineFromEvents(timeline, granularity, limit)
    };
  }

  private toTimelineFromEvents(
    events: ExchangeAnalyticsEvent[],
    granularity: DashboardTimeGranularity,
    limit: number
  ): ExchangeTimeseriesPoint[] {
    const grouped = new Map<string, MutableBucket>();

    for (const event of events) {
      const key = bucketTimestamp(event.occurredAt, granularity);
      const bucket = grouped.get(key) ?? createBucket(key);
      bucket.requests += 1;
      bucket.acceptedBids += event.payload.rejected ? 0 : 1;
      bucket.rejectedBids += event.payload.rejected ? 1 : 0;
      bucket.wins += event.payload.wonAuction ? 1 : 0;
      bucket.spend += event.payload.rejected ? 0 : event.payload.bidAmount;
      bucket.clearingSpend += event.payload.wonAuction ? event.payload.clearingPrice ?? event.payload.bidAmount : 0;
      bucket.attentionScoreTotal += event.payload.attentionScore;
      bucket.fraudScoreTotal += event.payload.fraudScore;
      bucket.suspiciousTrafficCount += event.payload.suspiciousTraffic ? 1 : 0;
      bucket.botTrafficCount += event.payload.qualityTier === "blocked" ? 1 : 0;
      bucket.revenueProxy += (event.payload.clearingPrice ?? event.payload.bidAmount) * event.payload.estimatedOutcomeRate * 5;
      bucket.estimatedOutcomes += event.payload.estimatedOutcomeRate;
      grouped.set(key, bucket);
    }

    return [...grouped.values()]
      .sort((left, right) => left.bucketStart.localeCompare(right.bucketStart))
      .slice(-limit)
      .map((bucket) => this.finalizeTimeseriesPoint(bucket));
  }

  private createEvent(request: ExchangeBidRequest, response: ExchangeBidResponse): ExchangeAnalyticsEvent {
    return {
      eventId: `${response.requestId}:${this.events.length + 1}`,
      eventType: response.status === "rejected"
        ? "bid-rejected"
        : response.isWinner
          ? "auction-won"
          : "bid-accepted",
      advertiserId: request.advertiserId,
      campaignId: request.placement.campaignId,
      slotId: request.placement.slotId,
      auctionId: request.placement.auctionId,
      creativeId: request.creativeId,
      requestId: response.requestId,
      occurredAt: request.occurredAt ?? nowIso(),
      payload: {
        bidAmount: response.finalBid,
        rankedBid: response.rankedBid,
        clearingPrice: response.clearingPrice,
        attentionScore: request.audience.attentionScore ?? 0.5,
        attentionMultiplier: response.pricing.attentionMultiplier,
        fraudScore: response.diagnostics.combinedScore,
        trustedTrafficScore: response.diagnostics.trustedTrafficScore,
        suspiciousTraffic: response.diagnostics.suspected,
        qualityTier: response.diagnostics.tier,
        wonAuction: response.isWinner,
        rejected: response.status === "rejected",
        viewabilityEstimate: request.placement.viewabilityEstimate,
        marketPressure: request.placement.marketPressure ?? 1,
        estimatedOutcomeRate: request.audience.conversionRate * (request.audience.attentionScore ?? 0.5)
      }
    };
  }

  private getLatestEvent(advertiserId: string): ExchangeAnalyticsEvent | undefined {
    return [...this.events].reverse().find((event) => event.advertiserId === advertiserId);
  }

  private getLatestActivityAt(advertiserId: string): string | null {
    return this.getLatestEvent(advertiserId)?.occurredAt ?? null;
  }
}

export const exchangeAnalyticsStore = new ExchangeAnalyticsStore();
