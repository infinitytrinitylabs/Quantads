/**
 * AdaptiveCreativeEngine — rules-based creative selection.
 *
 * Given an attention score (0-1), an emotional state, context signals,
 * device type, and time-of-day the engine selects the best-fit creative
 * variant (headline, image slot, CTA text, colour scheme, animation speed)
 * from a bank of 5 headline × 3 image × variable CTA combinations.
 *
 * The engine is deterministic: same inputs always produce the same output,
 * making it easy to test and audit.
 */

import type { EmotionalState } from "./EmotionDetector";

// ─── Public types ─────────────────────────────────────────────────────────────

export type DeviceType = "mobile" | "tablet" | "desktop";

export type ColorScheme =
  | "bold-dark"
  | "bold-light"
  | "calm-pastel"
  | "neutral-white"
  | "vibrant-gradient";

export type AnimationSpeed = "none" | "slow" | "medium" | "fast";

export interface AdaptiveCreativeInput {
  attentionScore: number;        // [0, 1]
  emotionalState: EmotionalState;
  context: string;               // free-text description of current activity
  deviceType: DeviceType;
  /** local hour [0-23] — lets the engine apply time-of-day rules */
  localHour: number;
  campaignId: string;
  /** optional baseline LTV to weight toward value-rich copy */
  audienceLtv?: number;
}

export interface CreativeVariant {
  variantId: string;
  headline: string;
  subheadline: string;
  bodyText: string;
  ctaText: string;
  imageSlot: 1 | 2 | 3;  // maps to three available image assets
  colorScheme: ColorScheme;
  animationSpeed: AnimationSpeed;
  /** hex background colour for inline-CSS use */
  backgroundColor: string;
  /** hex primary accent colour */
  accentColor: string;
  /** hex text colour */
  textColor: string;
  /** rationale shown by "Why this ad?" transparency overlay */
  targetingRationale: string[];
}

export interface AdaptiveCreativeResult {
  campaignId: string;
  variant: CreativeVariant;
  selectionRules: string[];
  computedAt: string;
}

// ─── Creative banks ───────────────────────────────────────────────────────────

/** Five headline tiers — index 0 = most attention-grabbing, 4 = most detailed */
const HEADLINE_BANK: [string, string][] = [
  ["🔥 Don't Miss This", "Limited offer, grab it now"],
  ["Act Fast — Exclusive Deal", "Tailored just for you"],
  ["Discover Something New", "Curated for your taste"],
  ["Learn More About This", "Read the full story"],
  ["A Detailed Look At This Product", "Comprehensive feature overview"]
];

/** Five body text tiers aligned with HEADLINE_BANK */
const BODY_BANK: string[] = [
  "Tap to claim your exclusive reward before it's gone. No strings attached.",
  "We picked this specifically for you. Thousands already love it — see why.",
  "Explore a hand-picked selection that matches your interests right now.",
  "This in-depth overview covers everything you need to make an informed decision.",
  "Our most detailed breakdown yet — perfect for when you have a moment to dive deep."
];

/** CTA bank keyed by emotional state */
const CTA_BANK: Record<EmotionalState, string[]> = {
  happy: ["Explore Now", "See More", "I Want This"],
  neutral: ["Learn More", "View Details", "Check It Out"],
  bored: ["Surprise Me!", "Something Different?", "Shake Things Up"],
  frustrated: ["Quick Fix", "One Tap Away", "Solve It Now"]
};

/** Color scheme definitions */
const COLOR_SCHEMES: Record<ColorScheme, { bg: string; accent: string; text: string }> = {
  "bold-dark": { bg: "#0f0f1a", accent: "#f43f5e", text: "#f1f5f9" },
  "bold-light": { bg: "#ffffff", accent: "#ef4444", text: "#111827" },
  "calm-pastel": { bg: "#fdf4ff", accent: "#a855f7", text: "#374151" },
  "neutral-white": { bg: "#f9fafb", accent: "#6366f1", text: "#1f2937" },
  "vibrant-gradient": { bg: "#0ea5e9", accent: "#f59e0b", text: "#ffffff" }
};

// ─── Rule definitions ─────────────────────────────────────────────────────────

interface SelectionRule {
  id: string;
  description: string;
  /** returns true if this rule applies */
  matches(input: AdaptiveCreativeInput): boolean;
  /** returns the tier index [0-4] or null to leave unchanged */
  headlineTier?: (input: AdaptiveCreativeInput) => number | null;
  colorScheme?: (input: AdaptiveCreativeInput) => ColorScheme | null;
  animationSpeed?: (input: AdaptiveCreativeInput) => AnimationSpeed | null;
  imageSlot?: (input: AdaptiveCreativeInput) => 1 | 2 | 3 | null;
}

const RULES: SelectionRule[] = [
  // ── Attention rules ────────────────────────────────────────────────────────

  {
    id: "low-attention-grabbing",
    description: "Attention < 0.3 → bold attention-grabbing creative with animation",
    matches: (i) => i.attentionScore < 0.3,
    headlineTier: () => 0,
    colorScheme: () => "bold-dark",
    animationSpeed: () => "fast",
    imageSlot: () => 1
  },
  {
    id: "medium-attention-balanced",
    description: "Attention 0.3–0.7 → balanced creative, medium animation",
    matches: (i) => i.attentionScore >= 0.3 && i.attentionScore <= 0.7,
    headlineTier: (i) => Math.round(2 + (i.attentionScore - 0.3) / 0.4),  // 2-3
    colorScheme: () => "vibrant-gradient",
    animationSpeed: () => "medium",
    imageSlot: () => 2
  },
  {
    id: "high-attention-detailed",
    description: "Attention > 0.7 → subtle, detailed creative with more text",
    matches: (i) => i.attentionScore > 0.7,
    headlineTier: () => 4,
    colorScheme: () => "neutral-white",
    animationSpeed: () => "slow",
    imageSlot: () => 3
  },

  // ── Emotion rules ──────────────────────────────────────────────────────────

  {
    id: "bored-humor",
    description: "Emotional state 'bored' → humor/entertainment creative",
    matches: (i) => i.emotionalState === "bored",
    headlineTier: () => 0,  // eye-catching
    colorScheme: () => "vibrant-gradient",
    animationSpeed: () => "fast",
    imageSlot: () => 1
  },
  {
    id: "frustrated-calm",
    description: "Emotional state 'frustrated' → calm reassuring creative, no animation",
    matches: (i) => i.emotionalState === "frustrated",
    colorScheme: () => "calm-pastel",
    animationSpeed: () => "slow",
    imageSlot: () => 2
  },
  {
    id: "happy-bright",
    description: "Emotional state 'happy' → vibrant, positive creative",
    matches: (i) => i.emotionalState === "happy",
    colorScheme: () => "vibrant-gradient",
    animationSpeed: () => "medium",
    imageSlot: () => 3
  },

  // ── Time-of-day rules ─────────────────────────────────────────────────────

  {
    id: "late-night-calm",
    description: "After 22:00 → calming colours, no animation",
    matches: (i) => i.localHour >= 22 || i.localHour < 6,
    colorScheme: () => "calm-pastel",
    animationSpeed: () => "none"
  },
  {
    id: "morning-energetic",
    description: "Between 06:00–09:00 → energetic, bold creative",
    matches: (i) => i.localHour >= 6 && i.localHour < 9,
    colorScheme: () => "bold-light",
    animationSpeed: () => "medium"
  },

  // ── Device rules ──────────────────────────────────────────────────────────

  {
    id: "mobile-short-copy",
    description: "Mobile device → shorter, more concise headline tier",
    matches: (i) => i.deviceType === "mobile",
    headlineTier: (i) => Math.max(0, Math.round(i.attentionScore * 2)),  // 0-2
    animationSpeed: (i) => (i.localHour >= 22 ? "none" : "medium")
  },

  // ── High-LTV audience ─────────────────────────────────────────────────────

  {
    id: "high-ltv-premium",
    description: "High-LTV audience (≥ 80) → premium detailed copy",
    matches: (i) => (i.audienceLtv ?? 0) >= 80,
    headlineTier: () => 3,
    colorScheme: () => "neutral-white",
    imageSlot: () => 3
  }
];

// ─── Rule engine ─────────────────────────────────────────────────────────────

function selectHeadlineTier(
  input: AdaptiveCreativeInput,
  appliedRules: SelectionRule[]
): number {
  // Last matching rule with a headlineTier wins (rules are ordered priority-first)
  for (let i = appliedRules.length - 1; i >= 0; i--) {
    const rule = appliedRules[i]!;
    if (rule.headlineTier) {
      const tier = rule.headlineTier(input);
      if (tier !== null) return clamp(tier, 0, 4);
    }
  }
  // Fallback: use attention to pick a tier linearly
  return clamp(Math.round((1 - input.attentionScore) * 4), 0, 4);
}

function selectColorScheme(
  input: AdaptiveCreativeInput,
  appliedRules: SelectionRule[]
): ColorScheme {
  for (let i = appliedRules.length - 1; i >= 0; i--) {
    const rule = appliedRules[i]!;
    if (rule.colorScheme) {
      const scheme = rule.colorScheme(input);
      if (scheme !== null) return scheme;
    }
  }
  return "neutral-white";
}

function selectAnimationSpeed(
  input: AdaptiveCreativeInput,
  appliedRules: SelectionRule[]
): AnimationSpeed {
  for (let i = appliedRules.length - 1; i >= 0; i--) {
    const rule = appliedRules[i]!;
    if (rule.animationSpeed) {
      const speed = rule.animationSpeed(input);
      if (speed !== null) return speed;
    }
  }
  return "medium";
}

function selectImageSlot(
  input: AdaptiveCreativeInput,
  appliedRules: SelectionRule[]
): 1 | 2 | 3 {
  for (let i = appliedRules.length - 1; i >= 0; i--) {
    const rule = appliedRules[i]!;
    if (rule.imageSlot) {
      const slot = rule.imageSlot(input);
      if (slot !== null) return slot;
    }
  }
  return 2;
}

function selectCta(emotionalState: EmotionalState, campaignId: string): string {
  const ctaList = CTA_BANK[emotionalState];
  // Deterministic pick based on campaign hash
  const hash = campaignId.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return ctaList[hash % ctaList.length]!;
}

function buildRationale(
  input: AdaptiveCreativeInput,
  appliedRules: SelectionRule[]
): string[] {
  const lines: string[] = [
    `Attention level: ${Math.round(input.attentionScore * 100)}%`,
    `Emotional state: ${input.emotionalState}`,
    `Device: ${input.deviceType}`,
    `Local hour: ${input.localHour}:00`
  ];
  for (const rule of appliedRules) {
    lines.push(`Applied rule: "${rule.description}"`);
  }
  return lines;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function buildVariantId(input: AdaptiveCreativeInput, tier: number): string {
  return [
    input.campaignId,
    "v",
    tier,
    input.emotionalState.slice(0, 3),
    Math.round(input.attentionScore * 10)
  ].join("-");
}

// ─── AdaptiveCreativeEngine ───────────────────────────────────────────────────

export class AdaptiveCreativeEngine {
  /**
   * Select the best creative variant for the given audience signal.
   */
  selectVariant(input: AdaptiveCreativeInput): AdaptiveCreativeResult {
    const appliedRules = RULES.filter((r) => r.matches(input));

    const tier = selectHeadlineTier(input, appliedRules);
    const colorScheme = selectColorScheme(input, appliedRules);
    const animationSpeed = selectAnimationSpeed(input, appliedRules);
    const imageSlot = selectImageSlot(input, appliedRules);
    const ctaText = selectCta(input.emotionalState, input.campaignId);
    const colors = COLOR_SCHEMES[colorScheme];
    const [headline, subheadline] = HEADLINE_BANK[tier]!;

    const variant: CreativeVariant = {
      variantId: buildVariantId(input, tier),
      headline,
      subheadline,
      bodyText: BODY_BANK[tier]!,
      ctaText,
      imageSlot,
      colorScheme,
      animationSpeed,
      backgroundColor: colors.bg,
      accentColor: colors.accent,
      textColor: colors.text,
      targetingRationale: buildRationale(input, appliedRules)
    };

    return {
      campaignId: input.campaignId,
      variant,
      selectionRules: appliedRules.map((r) => r.id),
      computedAt: new Date().toISOString()
    };
  }

  /**
   * Select variants for multiple attention levels simultaneously (used by the
   * advertiser preview that shows how the creative adapts).
   */
  previewAllLevels(
    base: Omit<AdaptiveCreativeInput, "attentionScore">
  ): Record<"low" | "medium" | "high", AdaptiveCreativeResult> {
    return {
      low: this.selectVariant({ ...base, attentionScore: 0.15 }),
      medium: this.selectVariant({ ...base, attentionScore: 0.5 }),
      high: this.selectVariant({ ...base, attentionScore: 0.85 })
    };
  }
}

export const adaptiveCreativeEngine = new AdaptiveCreativeEngine();
