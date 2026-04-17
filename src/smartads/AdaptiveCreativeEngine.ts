import { EmotionDetector, EmotionDetectionInput } from "./EmotionDetector";
import {
  AdaptiveCreativeDecision,
  AttentionBand,
  CreativeScoreContribution,
  EmotionInference,
  MessagingAngle,
  RankedCreativeOption,
  SmartAdRequest,
  SmartCreativeAsset,
  buildDefaultCreativeLibrary,
  clamp,
  round,
  toAttentionBand
} from "./types";

export interface AdaptiveCreativeEngineOptions {
  emotionDetector?: EmotionDetector;
}

const addContribution = (
  contributions: CreativeScoreContribution[],
  contribution: CreativeScoreContribution
): void => {
  contributions.push({ ...contribution, value: round(contribution.value) });
};

const includesLayout = (layout: SmartCreativeAsset["layout"], format: SmartAdRequest["placement"]["adFormat"]): boolean => {
  if (format === "story") {
    return layout === "story-stack" || layout === "immersive";
  }
  if (format === "display") {
    return layout === "spotlight" || layout === "commerce-card" || layout === "immersive";
  }
  if (format === "search") {
    return layout === "commerce-card" || layout === "spotlight";
  }
  return true;
};

const summarizeContributions = (contributions: CreativeScoreContribution[]): string[] => {
  return contributions
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value))
    .slice(0, 4)
    .map((entry) => `${entry.label}: ${entry.detail}`);
};

const buildHeadline = (
  creative: SmartCreativeAsset,
  request: SmartAdRequest,
  emotion: EmotionInference
): string => {
  if (emotion.primaryEmotion === "ready-to-convert" || emotion.primaryEmotion === "excited") {
    return request.product.offerHeadline ?? `${request.product.brandName} makes the next step feel obvious`;
  }
  if (emotion.primaryEmotion === "skeptical" || emotion.primaryEmotion === "overwhelmed") {
    return `${request.product.brandName} answers the last question before action`;
  }
  if (emotion.primaryEmotion === "curious") {
    return `A faster way to understand ${request.product.brandName}`;
  }
  return creative.headline;
};

const buildBody = (
  creative: SmartCreativeAsset,
  request: SmartAdRequest,
  emotion: EmotionInference
): string => {
  const value = request.product.valueProps.slice(0, 2).join(" · ");
  const proof = request.product.proofPoints[0] ?? "Measured outcomes in verified audiences";

  switch (emotion.messagingAngle) {
    case "education-led":
      return `${request.product.name} gives a quick, low-friction overview of ${value || request.product.category}. ${proof}.`;
    case "proof-led":
      return `${proof}. ${request.product.name} keeps the path to value clear for ${request.product.category} buyers.`;
    case "urgency-led":
      return `${value || request.product.name} is primed for high-intent attention windows. Act while response quality is elevated.`;
    case "reassurance-led":
      return `${request.product.name} reduces hesitation with trusted proof, clear pricing, and a calmer next step.`;
    case "community-led":
      return `${request.product.brandName} feels credible because buyers keep coming back for ${value || request.product.category}.`;
    default:
      return creative.body;
  }
};

const buildCta = (
  creative: SmartCreativeAsset,
  emotion: EmotionInference,
  request: SmartAdRequest
): string => {
  if (emotion.ctaStyle === "assertive") {
    return request.objectives.primaryOutcome === "purchase" ? "Buy now" : "Start now";
  }
  if (emotion.ctaStyle === "soft") {
    return request.objectives.primaryOutcome === "lead" ? "Review options" : "See details";
  }
  return creative.ctaLabel;
};

export class AdaptiveCreativeEngine {
  private readonly emotionDetector: EmotionDetector;

  constructor(options: AdaptiveCreativeEngineOptions = {}) {
    this.emotionDetector = options.emotionDetector ?? new EmotionDetector();
  }

  decide(request: SmartAdRequest, detectionInput?: EmotionDetectionInput): AdaptiveCreativeDecision {
    const emotion = detectionInput ? this.emotionDetector.detect(detectionInput) : this.emotionDetector.detect({
      interaction: request.interaction,
      audience: request.audience,
      history: request.history
    });
    const creatives = request.creativeInputs?.length
      ? request.creativeInputs
      : buildDefaultCreativeLibrary(request);
    const rankedOptions = creatives
      .map((creative) => this.rankCreative(creative, request, emotion))
      .sort((left, right) => right.totalScore - left.totalScore);
    const selected = rankedOptions.find((candidate) => candidate.eligible) ?? rankedOptions[0];

    if (!selected) {
      throw new Error("AdaptiveCreativeEngine could not rank any creatives");
    }

    const recommendedBidModifier = this.recommendBidModifier(request, emotion, selected.attentionBand);
    const recommendedFrequencyCap = this.recommendFrequencyCap(request, emotion);
    const reasoning = [
      `${selected.creativeName} selected for ${emotion.primaryEmotion} attention-aware delivery.`,
      ...summarizeContributions(selected.contributions),
      `Bid modifier ${round(recommendedBidModifier, 2)}x with frequency cap ${recommendedFrequencyCap}.`
    ];

    return {
      selected: selected.creative,
      emotion,
      rankedOptions,
      reasoning,
      recommendedBidModifier,
      recommendedFrequencyCap,
      dominantAttentionBand: selected.attentionBand,
      creativeStrategy: {
        headline: buildHeadline(selected.creative, request, emotion),
        body: buildBody(selected.creative, request, emotion),
        ctaLabel: buildCta(selected.creative, emotion, request),
        badges: this.buildBadges(selected.creative, request, emotion),
        proofPoints: this.buildProofPoints(selected.creative, request, emotion),
        emphasis: this.buildEmphasis(request, emotion, selected)
      }
    };
  }

  private rankCreative(
    creative: SmartCreativeAsset,
    request: SmartAdRequest,
    emotion: EmotionInference
  ): RankedCreativeOption {
    const contributions: CreativeScoreContribution[] = [];
    const attentionBand = emotion.attentionBand;
    let score = 0.2;

    const platformHit = creative.platformAffinity.includes(request.placement.platform);
    addContribution(contributions, {
      code: "platform-affinity",
      label: "Platform affinity",
      value: platformHit ? 0.18 : -0.03,
      detail: platformHit ? `${request.placement.platform} is a preferred delivery surface.` : "Creative is portable but not tailored to this platform."
    });
    score += platformHit ? 0.18 : -0.03;

    const deviceHit = creative.deviceAffinity.includes(request.placement.deviceCategory);
    addContribution(contributions, {
      code: "device-affinity",
      label: "Device affinity",
      value: deviceHit ? 0.11 : -0.04,
      detail: deviceHit ? `${request.placement.deviceCategory} device fit improves layout confidence.` : "Layout may be less natural on this device class."
    });
    score += deviceHit ? 0.11 : -0.04;

    const emotionHit = creative.emotionAffinity.includes(emotion.primaryEmotion);
    const emotionOverlap = creative.emotionAffinity.filter((label) =>
      emotion.rankedEmotions.slice(0, 3).some((entry) => entry.emotion === label)
    ).length;
    const emotionScore = emotionHit ? 0.2 + emotion.confidence * 0.06 : emotionOverlap * 0.04 - 0.02;
    addContribution(contributions, {
      code: "emotion-match",
      label: "Emotion match",
      value: emotionScore,
      detail: emotionHit
        ? `${creative.name} directly matches ${emotion.primaryEmotion}.`
        : `${emotionOverlap} secondary emotion overlaps detected.`
    });
    score += emotionScore;

    const attentionHit = creative.attentionBands.includes(attentionBand);
    const attentionScore = attentionHit ? 0.16 : -0.08;
    addContribution(contributions, {
      code: "attention-match",
      label: "Attention band",
      value: attentionScore,
      detail: attentionHit ? `${attentionBand} band is explicitly targeted.` : `${creative.name} is less aligned to ${attentionBand} attention.`
    });
    score += attentionScore;

    const layoutFit = includesLayout(creative.layout, request.placement.adFormat);
    const formatScore = layoutFit ? 0.12 : -0.16;
    addContribution(contributions, {
      code: "layout-fit",
      label: "Layout fit",
      value: formatScore,
      detail: layoutFit ? `${creative.layout} works in ${request.placement.adFormat}.` : `${creative.layout} is awkward for ${request.placement.adFormat}.`
    });
    score += formatScore;

    const viewabilityScore = round((request.placement.viewabilityEstimate - 0.5) * (creative.motion === "energetic" ? 0.2 : 0.1));
    addContribution(contributions, {
      code: "viewability-fit",
      label: "Viewability fit",
      value: viewabilityScore,
      detail: `${round(request.placement.viewabilityEstimate * 100, 1)}% estimated viewability.`
    });
    score += viewabilityScore;

    const objectiveScore = this.scoreObjectiveFit(creative, request, emotion);
    addContribution(contributions, {
      code: "objective-fit",
      label: "Objective fit",
      value: objectiveScore,
      detail: `${request.objectives.primaryOutcome} objective under ${request.objectives.priority} priority.`
    });
    score += objectiveScore;

    const ctaScore = this.scoreCtaFit(creative, emotion, request);
    addContribution(contributions, {
      code: "cta-fit",
      label: "CTA fit",
      value: ctaScore,
      detail: `${emotion.ctaStyle} CTA expected for ${emotion.primaryEmotion}.`
    });
    score += ctaScore;

    const freshnessScore = round(creative.noveltyWeight * (1 - (request.audience.fatigueScore ?? 0.3)) * 0.15);
    addContribution(contributions, {
      code: "freshness-bonus",
      label: "Freshness bonus",
      value: freshnessScore,
      detail: "Balances novelty against audience fatigue to avoid stale rotations."
    });
    score += freshnessScore;

    const fatiguePenalty = round(-1 * creative.fatiguePenalty * ((request.audience.fatigueScore ?? 0.3) + emotion.fatigueRisk) * 0.28);
    addContribution(contributions, {
      code: "fatigue-penalty",
      label: "Fatigue penalty",
      value: fatiguePenalty,
      detail: `Audience fatigue risk ${round(Math.max(request.audience.fatigueScore ?? 0.3, emotion.fatigueRisk) * 100, 1)}%.`
    });
    score += fatiguePenalty;

    const trustScore = round(creative.trustWeight * (emotion.primaryEmotion === "skeptical" || emotion.primaryEmotion === "overwhelmed" ? 0.18 : 0.08));
    addContribution(contributions, {
      code: "trust-match",
      label: "Trust match",
      value: trustScore,
      detail: "Creative proof density is weighted against the current emotional need for reassurance."
    });
    score += trustScore;

    const urgencyScore = round(creative.urgency * (emotion.primaryEmotion === "ready-to-convert" || emotion.primaryEmotion === "excited" ? 0.16 : 0.04));
    addContribution(contributions, {
      code: "urgency-match",
      label: "Urgency match",
      value: urgencyScore,
      detail: `Urgency scaled to ${emotion.primaryEmotion} momentum.`
    });
    score += urgencyScore;

    const priceFit = round(this.scorePriceFit(request, creative, emotion));
    addContribution(contributions, {
      code: "price-fit",
      label: "Price fit",
      value: priceFit,
      detail: `Price framing tuned to ${request.product.currency ?? "USD"} ${round(request.product.price, 2)}.`
    });
    score += priceFit;

    const historyFit = round(this.scoreHistoryFit(request, creative, emotion));
    addContribution(contributions, {
      code: "history-fit",
      label: "History fit",
      value: historyFit,
      detail: "Recent delivery signals and prior emotional state influence rotation choices."
    });
    score += historyFit;

    const normalizedScore = clamp(score, 0, 1.6) / 1.6;
    const eligible = score > 0.16 && layoutFit && request.placement.width >= 220 && request.placement.height >= 120;

    return {
      creativeId: creative.creativeId,
      creativeName: creative.name,
      totalScore: round(score),
      normalizedScore: round(normalizedScore),
      eligible,
      attentionBand,
      messagingAngle: emotion.messagingAngle,
      contributions,
      creative
    };
  }

  private scoreObjectiveFit(
    creative: SmartCreativeAsset,
    request: SmartAdRequest,
    emotion: EmotionInference
  ): number {
    const base = request.objectives.priority === "conversion"
      ? creative.messagingAngle === "urgency-led" || creative.messagingAngle === "proof-led"
        ? 0.17
        : 0.05
      : request.objectives.priority === "attention"
        ? creative.layout === "immersive" || creative.layout === "story-stack"
          ? 0.17
          : 0.06
        : request.objectives.priority === "retention"
          ? creative.messagingAngle === "community-led" || creative.messagingAngle === "reassurance-led"
            ? 0.15
            : 0.04
          : 0.08;

    const emotionBoost = emotion.primaryEmotion === "ready-to-convert" && request.objectives.primaryOutcome !== "watch"
      ? 0.05
      : emotion.primaryEmotion === "curious" && request.objectives.primaryOutcome === "watch"
        ? 0.04
        : 0;

    return round(base + emotionBoost);
  }

  private scoreCtaFit(
    creative: SmartCreativeAsset,
    emotion: EmotionInference,
    request: SmartAdRequest
  ): number {
    const wantsAssertive = emotion.ctaStyle === "assertive";
    const assertiveLabel = /claim|buy|start|install|get/i.test(creative.ctaLabel);
    const softLabel = /learn|review|details|why/i.test(creative.ctaLabel);

    if (wantsAssertive && assertiveLabel) {
      return 0.1;
    }
    if (emotion.ctaStyle === "soft" && softLabel) {
      return 0.1;
    }
    if (request.objectives.primaryOutcome === "lead" && /review|book|talk/i.test(creative.ctaLabel)) {
      return 0.08;
    }
    return 0.02;
  }

  private scorePriceFit(
    request: SmartAdRequest,
    creative: SmartCreativeAsset,
    emotion: EmotionInference
  ): number {
    const priceSensitivity = clamp(1 - (request.audience.purchasePowerIndex ?? 0.5), 0, 1);
    const compareDiscount = request.product.compareAtPrice && request.product.compareAtPrice > request.product.price
      ? clamp((request.product.compareAtPrice - request.product.price) / request.product.compareAtPrice, 0, 0.8)
      : 0;
    const urgencyBias = creative.urgency * (emotion.primaryEmotion === "ready-to-convert" ? 1 : 0.45);
    return (compareDiscount * 0.16 + urgencyBias * 0.08) - priceSensitivity * 0.06;
  }

  private scoreHistoryFit(
    request: SmartAdRequest,
    creative: SmartCreativeAsset,
    emotion: EmotionInference
  ): number {
    const repeatedExposurePenalty = request.history?.recentImpressions && request.history.recentImpressions > 10
      ? -0.06
      : 0;
    const previousEmotionBoost = request.history?.previousEmotion && request.history.previousEmotion !== emotion.primaryEmotion
      ? creative.noveltyWeight * 0.05
      : 0.01;
    const conversionMemoryBoost = request.history?.recentConversions
      ? clamp(request.history.recentConversions / 4, 0, 0.07)
      : 0;

    return round(repeatedExposurePenalty + previousEmotionBoost + conversionMemoryBoost);
  }

  private recommendBidModifier(
    request: SmartAdRequest,
    emotion: EmotionInference,
    attentionBand: AttentionBand
  ): number {
    const attentionMultiplier = attentionBand === "immersed" ? 1.16 : attentionBand === "engaged" ? 1.07 : 0.94;
    const intentMultiplier = 0.92 + request.audience.intentScore * 0.22;
    const fatigueGuard = 1 - emotion.fatigueRisk * 0.18;
    const conversionBias = emotion.primaryEmotion === "ready-to-convert" ? 1.08 : emotion.primaryEmotion === "frustrated" ? 0.92 : 1;
    return round(clamp(attentionMultiplier * intentMultiplier * fatigueGuard * conversionBias, 0.82, 1.34), 3);
  }

  private recommendFrequencyCap(request: SmartAdRequest, emotion: EmotionInference): number {
    const fatigueScore = Math.max(request.audience.fatigueScore ?? 0.3, emotion.fatigueRisk);
    if (fatigueScore >= 0.75) {
      return 2;
    }
    if (fatigueScore >= 0.55) {
      return 3;
    }
    if (emotion.primaryEmotion === "ready-to-convert") {
      return 6;
    }
    return 4;
  }

  private buildBadges(
    creative: SmartCreativeAsset,
    request: SmartAdRequest,
    emotion: EmotionInference
  ): string[] {
    const badges = [...creative.badges];
    if (emotion.primaryEmotion === "ready-to-convert") {
      badges.unshift("High intent");
    }
    if (request.product.compareAtPrice && request.product.compareAtPrice > request.product.price) {
      const savings = round(request.product.compareAtPrice - request.product.price, 2);
      badges.push(`Save ${savings.toFixed(2)}`);
    }
    return badges.slice(0, 4);
  }

  private buildProofPoints(
    creative: SmartCreativeAsset,
    request: SmartAdRequest,
    emotion: EmotionInference
  ): string[] {
    const proofPoints = [...creative.proofPoints];
    if (emotion.primaryEmotion === "skeptical" || emotion.primaryEmotion === "overwhelmed") {
      proofPoints.unshift("Clear onboarding and verified buyer trust signals");
    }
    if (request.product.proofPoints.length) {
      proofPoints.push(request.product.proofPoints[0]);
    }
    return Array.from(new Set(proofPoints)).slice(0, 3);
  }

  private buildEmphasis(
    request: SmartAdRequest,
    emotion: EmotionInference,
    selected: RankedCreativeOption
  ): string {
    if (emotion.primaryEmotion === "ready-to-convert") {
      return `Lead with ${request.product.name} value density, price clarity, and a decisive CTA.`;
    }
    if (emotion.primaryEmotion === "skeptical" || emotion.primaryEmotion === "overwhelmed") {
      return `Slow the frame down and let ${selected.creative.name} foreground trust, clarity, and low-risk proof.`;
    }
    if (toAttentionBand(request.audience.attentionScore ?? 0.5) === "glance") {
      return `Keep the first screen instantly legible with one vivid proof point and one compact badge.`;
    }
    return `Maintain attention with ${selected.creative.layout} pacing and ${selected.messagingAngle} narrative framing.`;
  }
}
