import { DeviceCategory, ExchangeInteractionSnapshot, ExchangePlatform } from "../exchange/types";

export type AttentionBand = "glance" | "engaged" | "immersed";
export type EmotionLabel =
  | "curious"
  | "focused"
  | "excited"
  | "delighted"
  | "skeptical"
  | "frustrated"
  | "overwhelmed"
  | "ready-to-convert"
  | "neutral";
export type MessagingAngle =
  | "benefit-led"
  | "proof-led"
  | "urgency-led"
  | "education-led"
  | "reassurance-led"
  | "community-led";
export type SmartAdLayout = "spotlight" | "immersive" | "commerce-card" | "story-stack";
export type SmartAdMotion = "still" | "gentle" | "energetic";
export type SmartPriority = "reach" | "attention" | "conversion" | "retention";
export type PrimaryOutcome = "purchase" | "install" | "signup" | "lead" | "watch" | "visit";
export type ReasonCode =
  | "platform-affinity"
  | "device-affinity"
  | "emotion-match"
  | "attention-match"
  | "fatigue-penalty"
  | "freshness-bonus"
  | "urgency-match"
  | "trust-match"
  | "layout-fit"
  | "viewability-fit"
  | "objective-fit"
  | "cta-fit"
  | "history-fit"
  | "price-fit";

export interface SmartAdPlacement {
  platform: ExchangePlatform;
  adFormat: "native-card" | "story" | "search" | "rewarded" | "video" | "display";
  width: number;
  height: number;
  density?: number;
  deviceCategory: DeviceCategory;
  placementPath: string;
  viewabilityEstimate: number;
  locale?: string;
  localHour?: number;
}

export interface SmartAdAudience {
  verifiedLtv: number;
  intentScore: number;
  conversionRate: number;
  attentionScore?: number;
  fatigueScore?: number;
  familiarityScore?: number;
  purchasePowerIndex?: number;
  recentWins?: number;
  recentLosses?: number;
  lastEmotion?: EmotionLabel;
}

export interface SmartAdObjectives {
  primaryOutcome: PrimaryOutcome;
  priority: SmartPriority;
  targetCpa?: number;
  targetRoas?: number;
  budgetSensitivity?: number;
}

export interface SmartAdProduct {
  name: string;
  brandName: string;
  category: string;
  price: number;
  compareAtPrice?: number;
  currency?: string;
  offerHeadline?: string;
  offerBody?: string;
  destinationUrl: string;
  imageUrl?: string;
  valueProps: string[];
  proofPoints: string[];
  badges?: string[];
}

export interface SmartAdHistory {
  recentImpressions?: number;
  recentClicks?: number;
  recentConversions?: number;
  priorAttentionDelta?: number;
  previousEmotion?: EmotionLabel;
  dwellTrend?: number;
  averageScrollDepth?: number;
}

export interface SmartAdEnvironment {
  contentGenre?: string;
  sessionDepth?: number;
  culturalMoment?: string;
  soundtrackEnergy?: number;
}

export interface SmartCreativePalette {
  background: string;
  surface: string;
  accent: string;
  accentSoft: string;
  text: string;
  mutedText: string;
  ctaText: string;
  border: string;
  shadow: string;
}

export interface SmartCreativeAsset {
  creativeId: string;
  campaignId: string;
  name: string;
  headline: string;
  body: string;
  ctaLabel: string;
  layout: SmartAdLayout;
  format: SmartAdPlacement["adFormat"];
  motion: SmartAdMotion;
  messagingAngle: MessagingAngle;
  emotionAffinity: EmotionLabel[];
  attentionBands: AttentionBand[];
  platformAffinity: ExchangePlatform[];
  deviceAffinity: DeviceCategory[];
  valueProps: string[];
  proofPoints: string[];
  badges: string[];
  keywords: string[];
  palette: SmartCreativePalette;
  urgency: number;
  trustWeight: number;
  noveltyWeight: number;
  fatiguePenalty: number;
}

export interface SmartAdRequest {
  advertiserId: string;
  campaignId: string;
  userId?: string;
  placement: SmartAdPlacement;
  audience: SmartAdAudience;
  objectives: SmartAdObjectives;
  product: SmartAdProduct;
  interaction: ExchangeInteractionSnapshot;
  history?: SmartAdHistory;
  environment?: SmartAdEnvironment;
  creativeInputs?: SmartCreativeAsset[];
}

export interface BehavioralSignal {
  id: string;
  label: string;
  value: number;
  normalized: number;
  direction: "up" | "down" | "flat";
  interpretation: string;
}

export interface EmotionInference {
  primaryEmotion: EmotionLabel;
  confidence: number;
  scores: Record<EmotionLabel, number>;
  rankedEmotions: Array<{ emotion: EmotionLabel; score: number }>;
  signals: BehavioralSignal[];
  attentionBand: AttentionBand;
  pacing: "calm" | "balanced" | "fast";
  messagingAngle: MessagingAngle;
  ctaStyle: "soft" | "balanced" | "assertive";
  fatigueRisk: number;
  opportunityScore: number;
  explanation: string[];
}

export interface CreativeScoreContribution {
  code: ReasonCode;
  label: string;
  value: number;
  detail: string;
}

export interface RankedCreativeOption {
  creativeId: string;
  creativeName: string;
  totalScore: number;
  normalizedScore: number;
  eligible: boolean;
  attentionBand: AttentionBand;
  messagingAngle: MessagingAngle;
  contributions: CreativeScoreContribution[];
  creative: SmartCreativeAsset;
}

export interface AdaptiveCreativeDecision {
  selected: SmartCreativeAsset;
  emotion: EmotionInference;
  rankedOptions: RankedCreativeOption[];
  reasoning: string[];
  recommendedBidModifier: number;
  recommendedFrequencyCap: number;
  dominantAttentionBand: AttentionBand;
  creativeStrategy: {
    headline: string;
    body: string;
    ctaLabel: string;
    badges: string[];
    proofPoints: string[];
    emphasis: string;
  };
}

export interface CompositionLayer {
  layerId: string;
  type: "background" | "glow" | "badge" | "text" | "cta" | "meter" | "proof" | "footer" | "shape";
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  text?: string;
  opacity?: number;
}

export interface CompositionMetrics {
  headlineLines: number;
  bodyLines: number;
  badgeCount: number;
  proofPointCount: number;
  canvasFillRatio: number;
  ctaProminence: number;
  motionEnergy: number;
}

export interface SmartAdComposition {
  width: number;
  height: number;
  layers: CompositionLayer[];
  metrics: CompositionMetrics;
  palette: SmartCreativePalette;
  operationLog: string[];
  altText: string;
  ariaLabel: string;
  headline: string;
  body: string;
  ctaLabel: string;
  footer: string;
  badges: string[];
  proofPoints: string[];
}

export interface RenderChipModel {
  id: string;
  label: string;
  tone: "accent" | "surface" | "positive" | "warning" | "neutral";
}

export interface RenderMetricModel {
  id: string;
  label: string;
  value: string;
}

export interface SmartAdRenderModel {
  containerStyle: Record<string, string | number>;
  headerStyle: Record<string, string | number>;
  bodyStyle: Record<string, string | number>;
  ctaStyle: Record<string, string | number>;
  badgeStyle: Record<string, string | number>;
  footerStyle: Record<string, string | number>;
  headline: string;
  body: string;
  ctaLabel: string;
  brandLabel: string;
  supportingText: string;
  badges: RenderChipModel[];
  proofPoints: string[];
  metrics: RenderMetricModel[];
  accessibility: {
    role: string;
    ariaLabel: string;
    altText: string;
  };
}

export const SMART_EMOTIONS: EmotionLabel[] = [
  "curious",
  "focused",
  "excited",
  "delighted",
  "skeptical",
  "frustrated",
  "overwhelmed",
  "ready-to-convert",
  "neutral"
];

export const clamp = (value: number, minimum: number, maximum: number): number => {
  return Math.min(Math.max(value, minimum), maximum);
};

export const round = (value: number, digits = 4): number => {
  return Number(value.toFixed(digits));
};

export const average = (values: number[]): number => {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

export const toAttentionBand = (attentionScore: number): AttentionBand => {
  if (attentionScore >= 0.72) {
    return "immersed";
  }
  if (attentionScore >= 0.42) {
    return "engaged";
  }
  return "glance";
};

export const withAlpha = (hexColor: string, alpha: number): string => {
  const normalized = hexColor.replace("#", "").padEnd(6, "0").slice(0, 6);
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${round(alpha, 3)})`;
};

export const formatCurrency = (value: number, currency = "USD"): string => {
  const rounded = round(value, 2).toFixed(2);
  if (["USD", "USDC", "USDT", "DAI"].includes(currency.toUpperCase())) {
    return `$${rounded}`;
  }
  return `${currency.toUpperCase()} ${rounded}`;
};

export const summarizeEmotion = (emotion: EmotionInference): string => {
  return `${emotion.primaryEmotion} (${round(emotion.confidence * 100, 1)}% confidence)`;
};

export const createDefaultPalette = (accent: string): SmartCreativePalette => ({
  background: "#09111f",
  surface: withAlpha(accent, 0.16),
  accent,
  accentSoft: withAlpha(accent, 0.3),
  text: "#f8fbff",
  mutedText: "#9cb4d2",
  ctaText: "#08111f",
  border: withAlpha(accent, 0.28),
  shadow: withAlpha("#020617", 0.42)
});

export const buildDefaultCreativeLibrary = (request: SmartAdRequest): SmartCreativeAsset[] => {
  const badgeSeed = request.product.badges?.slice(0, 2) ?? [];
  const proofSeed = request.product.proofPoints.slice(0, 3);
  const valueSeed = request.product.valueProps.slice(0, 3);

  return [
    {
      creativeId: `${request.campaignId}-focus-proof`,
      campaignId: request.campaignId,
      name: "Focus proof card",
      headline: request.product.offerHeadline ?? `${request.product.brandName} keeps momentum high`,
      body: request.product.offerBody ?? `${request.product.name} turns high-attention sessions into measurable outcomes with proof-led framing.`,
      ctaLabel: "See proof",
      layout: "commerce-card",
      format: request.placement.adFormat,
      motion: "gentle",
      messagingAngle: "proof-led",
      emotionAffinity: ["focused", "skeptical", "ready-to-convert"],
      attentionBands: ["engaged", "immersed"],
      platformAffinity: [request.placement.platform, "quantedits", "quantmail"],
      deviceAffinity: [request.placement.deviceCategory, "desktop", "mobile"],
      valueProps: valueSeed,
      proofPoints: proofSeed,
      badges: [...badgeSeed, "Verified outcomes"],
      keywords: [request.product.category, "proof", "performance", "outcomes"],
      palette: createDefaultPalette("#4cc9f0"),
      urgency: 0.42,
      trustWeight: 0.9,
      noveltyWeight: 0.45,
      fatiguePenalty: 0.1
    },
    {
      creativeId: `${request.campaignId}-curious-story`,
      campaignId: request.campaignId,
      name: "Curiosity story stack",
      headline: `Why ${request.product.brandName} is resonating right now`,
      body: `${request.product.name} leans on discovery cues, compact storytelling, and social proof for attention-aware placements.`,
      ctaLabel: "Discover why",
      layout: "story-stack",
      format: request.placement.adFormat,
      motion: "gentle",
      messagingAngle: "education-led",
      emotionAffinity: ["curious", "neutral", "delighted"],
      attentionBands: ["glance", "engaged"],
      platformAffinity: [request.placement.platform, "quanttube", "quantbrowse"],
      deviceAffinity: ["mobile", request.placement.deviceCategory],
      valueProps: valueSeed,
      proofPoints: proofSeed,
      badges: [...badgeSeed, "Fresh creative"],
      keywords: [request.product.category, "discover", "learn", "fresh"],
      palette: createDefaultPalette("#80ed99"),
      urgency: 0.26,
      trustWeight: 0.58,
      noveltyWeight: 0.92,
      fatiguePenalty: 0.06
    },
    {
      creativeId: `${request.campaignId}-urgency-spotlight`,
      campaignId: request.campaignId,
      name: "Urgency spotlight",
      headline: `${request.product.brandName} offer while attention is peaking`,
      body: `${request.product.name} pairs concise value props with a decisive CTA for high-intent moments.`,
      ctaLabel: "Claim offer",
      layout: "spotlight",
      format: request.placement.adFormat,
      motion: "energetic",
      messagingAngle: "urgency-led",
      emotionAffinity: ["excited", "ready-to-convert", "focused"],
      attentionBands: ["immersed", "engaged"],
      platformAffinity: [request.placement.platform, "quantchat", "quantmail"],
      deviceAffinity: ["mobile", "desktop", request.placement.deviceCategory],
      valueProps: valueSeed,
      proofPoints: proofSeed,
      badges: [...badgeSeed, "Limited window"],
      keywords: [request.product.category, "offer", "limited", "save"],
      palette: createDefaultPalette("#ffd166"),
      urgency: 0.94,
      trustWeight: 0.51,
      noveltyWeight: 0.66,
      fatiguePenalty: 0.18
    },
    {
      creativeId: `${request.campaignId}-reassurance-immersive`,
      campaignId: request.campaignId,
      name: "Reassurance immersive",
      headline: `${request.product.brandName} removes the last bit of doubt`,
      body: `${request.product.name} highlights guarantees, credibility, and calm reassurance when signals suggest friction.`,
      ctaLabel: "Review details",
      layout: "immersive",
      format: request.placement.adFormat,
      motion: "still",
      messagingAngle: "reassurance-led",
      emotionAffinity: ["skeptical", "overwhelmed", "frustrated"],
      attentionBands: ["glance", "engaged"],
      platformAffinity: [request.placement.platform, "quantmail", "quantbrowse"],
      deviceAffinity: ["desktop", "tablet", request.placement.deviceCategory],
      valueProps: valueSeed,
      proofPoints: [...proofSeed, "Low-friction onboarding"],
      badges: [...badgeSeed, "Trusted by verified buyers"],
      keywords: [request.product.category, "trusted", "guarantee", "confidence"],
      palette: createDefaultPalette("#cdb4db"),
      urgency: 0.18,
      trustWeight: 0.96,
      noveltyWeight: 0.3,
      fatiguePenalty: 0.05
    }
  ];
};
