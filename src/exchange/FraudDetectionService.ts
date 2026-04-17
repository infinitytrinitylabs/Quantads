import { BotHeuristicsEngine } from "./BotHeuristicsEngine";
import { IsolationForest } from "./IsolationForest";
import {
  CombinedFraudAssessment,
  ExchangeBidRequest,
  IsolationFeatureVector,
  TrafficQualityTier
} from "./types";
import { average, clamp, logistic, round } from "./math";

const FEATURE_LABELS = [
  "verifiedLtv",
  "intentScore",
  "conversionRate",
  "attentionScore",
  "cohortQualityScore",
  "historicalCtr",
  "historicalOutcomeRate",
  "viewabilityEstimate",
  "marketPressure",
  "publisherQualityScore",
  "contentSafetyScore",
  "focusDurationSeconds",
  "pointerEvents",
  "pointerEntropy",
  "scrollDepth",
  "rageClicks",
  "copyPasteEvents",
  "hoverTargets",
  "formInteractions",
  "pageViewsInSession",
  "tabCount",
  "localHour",
  "timezoneOffset",
  "viewportWidth",
  "viewportHeight",
  "viewportDensity",
  "deviceCategory",
  "browserFamily",
  "connectionType",
  "geoEntropy"
] as const;

const pointerEntropy = (request: ExchangeBidRequest): number => {
  const samples = request.interaction.pointerSamples ?? [];
  if (!samples.length) {
    return 0;
  }

  const magnitudes = samples.map((sample) => Math.sqrt(sample.dx ** 2 + sample.dy ** 2));
  const mean = average(magnitudes);
  const variance = average(magnitudes.map((value) => (value - mean) ** 2));
  const dwellMean = average(samples.map((sample) => sample.dtMs));
  return round(clamp((Math.sqrt(variance) + mean + dwellMean / 100) / 50, 0, 1), 6);
};

const encodeDeviceCategory = (value: string): number => {
  switch (value) {
    case "desktop":
      return 0.1;
    case "mobile":
      return 0.35;
    case "tablet":
      return 0.55;
    case "tv":
      return 0.75;
    default:
      return 0.95;
  }
};

const encodeBrowserFamily = (value: string): number => {
  switch (value) {
    case "chrome":
      return 0.2;
    case "safari":
      return 0.35;
    case "firefox":
      return 0.5;
    case "edge":
      return 0.65;
    case "bot":
      return 1;
    default:
      return 0.8;
  }
};

const encodeConnectionType = (value: string | undefined): number => {
  switch (value) {
    case "wifi":
      return 0.2;
    case "cellular":
      return 0.45;
    case "ethernet":
      return 0.35;
    case "offline":
      return 1;
    default:
      return 0.7;
  }
};

const geoEntropy = (request: ExchangeBidRequest): number => {
  const country = request.placement.geo?.country ?? "ZZ";
  const region = request.placement.geo?.region ?? "";
  const city = request.placement.geo?.city ?? "";
  const score = (country.length + region.length / 2 + city.length / 3) / 10;
  return round(clamp(score, 0, 1), 6);
};

export class FraudDetectionService {
  private readonly heuristics = new BotHeuristicsEngine();
  private readonly isolationForest = new IsolationForest();

  assess(request: ExchangeBidRequest): CombinedFraudAssessment {
    const featureVector = this.buildFeatureVector(request);
    const heuristics = this.heuristics.evaluate(request);
    const isolationForest = this.isolationForest.score(featureVector);

    const hardBlockRuleIds = new Set([
      "device.bot-signature",
      "signature.automation-token",
      "network.offline-request",
      "engagement.zero-focus"
    ]);
    const hardBlockTriggered = heuristics.triggeredRules.some((rule) => hardBlockRuleIds.has(rule.id));

    let combinedScore = round(
      clamp(
        heuristics.score * 0.58 + isolationForest.normalizedScore * 0.42 + heuristics.confidence * 0.06,
        0,
        1
      ),
      6
    );
    if (hardBlockTriggered) {
      combinedScore = Math.max(combinedScore, 0.92);
    }

    const trustedTrafficScore = round(clamp(1 - combinedScore, 0, 1), 6);
    const suspected = hardBlockTriggered || combinedScore >= 0.52 || heuristics.suspected || isolationForest.suspected;
    const tier = hardBlockTriggered ? "blocked" : this.resolveTier(combinedScore, heuristics.tier);
    const decision = hardBlockTriggered || combinedScore >= 0.86 ? "rejected" : combinedScore >= 0.66 ? "shadowed" : "accepted";
    const reviewReasons = [
      ...heuristics.reasons,
      isolationForest.reason,
      `Combined fraud score ${combinedScore} and trusted traffic score ${trustedTrafficScore}`,
      ...(hardBlockTriggered ? ["Hard-block bot signatures triggered automatic exchange rejection"] : [])
    ];

    if (decision === "accepted") {
      this.isolationForest.ingest(featureVector, request.requestId ?? request.placement.auctionId, request.occurredAt);
    }

    return {
      combinedScore,
      trustedTrafficScore,
      suspected,
      decision,
      tier,
      heuristics,
      isolationForest,
      reviewReasons
    };
  }

  getModelSnapshot(): { sampleSize: number; treeCount: number; featureLabels: string[] } {
    return this.isolationForest.snapshot();
  }

  getFeatureDrift(): Array<{ label: string; mean: number; standardDeviation: number }> {
    return this.isolationForest.describeFeatureDrift();
  }

  buildFeatureVector(request: ExchangeBidRequest): IsolationFeatureVector {
    const values = [
      request.audience.verifiedLtv,
      request.audience.intentScore,
      request.audience.conversionRate,
      request.audience.attentionScore ?? 0.5,
      request.audience.cohortQualityScore ?? 0.5,
      request.audience.historicalCtr ?? 0.03,
      request.audience.historicalOutcomeRate ?? 0.01,
      request.placement.viewabilityEstimate,
      request.placement.marketPressure ?? 1,
      request.placement.publisherQualityScore ?? 0.7,
      request.placement.contentSafetyScore ?? 0.9,
      request.interaction.focusDurationMs / 1000,
      request.interaction.pointerEvents,
      pointerEntropy(request),
      request.interaction.scrollDepth,
      request.interaction.rageClicks,
      request.interaction.copyPasteEvents,
      request.interaction.hoverTargets,
      request.interaction.formInteractions,
      request.fingerprint.pageViewsInSession ?? 0,
      request.fingerprint.tabCount ?? 1,
      request.fingerprint.localHour ?? 12,
      request.fingerprint.timezoneOffsetMinutes ?? request.placement.geo?.timezoneOffsetMinutes ?? 0,
      request.placement.viewport.width,
      request.placement.viewport.height,
      request.placement.viewport.density,
      encodeDeviceCategory(request.fingerprint.deviceCategory),
      encodeBrowserFamily(request.fingerprint.browserFamily),
      encodeConnectionType(request.fingerprint.connectionType),
      geoEntropy(request)
    ].map((value) => round(value, 6));

    return {
      labels: [...FEATURE_LABELS],
      values
    };
  }

  private resolveTier(score: number, heuristicsTier: TrafficQualityTier): TrafficQualityTier {
    if (score >= 0.86) {
      return "blocked";
    }

    if (score >= 0.6) {
      return "discounted";
    }

    if (heuristicsTier === "premium" && score < 0.25) {
      return "premium";
    }

    return "standard";
  }
}
