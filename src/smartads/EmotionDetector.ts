import { AggregatedBciMetrics } from "../bci/AttentionStore";
import { ExchangeInteractionSnapshot } from "../exchange/types";
import {
  AttentionBand,
  BehavioralSignal,
  EmotionInference,
  EmotionLabel,
  MessagingAngle,
  SMART_EMOTIONS,
  SmartAdAudience,
  SmartAdHistory,
  average,
  clamp,
  round,
  toAttentionBand
} from "./types";

export interface EmotionDetectionInput {
  interaction: ExchangeInteractionSnapshot;
  audience: SmartAdAudience;
  history?: SmartAdHistory;
  bciMetrics?: AggregatedBciMetrics | null;
}

export interface EmotionDetectorTuning {
  rageWeight: number;
  explorationWeight: number;
  immersionWeight: number;
  purchaseWeight: number;
  fatigueWeight: number;
}

const DEFAULT_TUNING: EmotionDetectorTuning = {
  rageWeight: 1,
  explorationWeight: 1,
  immersionWeight: 1,
  purchaseWeight: 1,
  fatigueWeight: 1
};

const signal = (
  id: string,
  label: string,
  value: number,
  normalized: number,
  interpretation: string,
  direction: BehavioralSignal["direction"]
): BehavioralSignal => ({
  id,
  label,
  value: round(value),
  normalized: round(normalized),
  interpretation,
  direction
});

const normalizeRate = (value: number, maxValue: number): number => {
  if (maxValue <= 0) {
    return 0;
  }
  return clamp(value / maxValue, 0, 1);
};

const summarizeRankedEmotions = (ranked: Array<{ emotion: EmotionLabel; score: number }>): string[] => {
  return ranked.slice(0, 3).map((entry) => `${entry.emotion}=${round(entry.score * 100, 1)}%`);
};

export class EmotionDetector {
  constructor(private readonly tuning: EmotionDetectorTuning = DEFAULT_TUNING) {}

  detect(input: EmotionDetectionInput): EmotionInference {
    const signals = this.buildSignals(input);
    const scores = this.scoreEmotions(input, signals);
    const rankedEmotions = SMART_EMOTIONS
      .map((emotion) => ({ emotion, score: round(scores[emotion]) }))
      .sort((left, right) => right.score - left.score);
    const top = rankedEmotions[0] ?? { emotion: "neutral" as EmotionLabel, score: 0 };
    const runnerUp = rankedEmotions[1] ?? { emotion: "neutral" as EmotionLabel, score: 0 };
    const confidence = clamp(top.score - runnerUp.score + 0.35, 0.18, 0.97);
    const attentionBand = this.resolveAttentionBand(input, signals);
    const pacing = this.resolvePacing(top.emotion, attentionBand);
    const messagingAngle = this.resolveMessagingAngle(top.emotion, input.audience.intentScore);
    const ctaStyle = top.emotion === "ready-to-convert" || top.emotion === "excited"
      ? "assertive"
      : top.emotion === "skeptical" || top.emotion === "overwhelmed"
        ? "soft"
        : "balanced";
    const fatigueRisk = clamp(
      average([
        input.audience.fatigueScore ?? 0.3,
        signals.find((entry) => entry.id === "fatigue")?.normalized ?? 0,
        input.history?.recentImpressions ? normalizeRate(input.history.recentImpressions, 18) : 0
      ]),
      0,
      1
    );
    const opportunityScore = clamp(
      average([
        input.audience.intentScore,
        input.audience.conversionRate,
        input.audience.attentionScore ?? 0.5,
        confidence,
        1 - fatigueRisk
      ]),
      0,
      1
    );

    return {
      primaryEmotion: top.emotion,
      confidence: round(confidence),
      scores: Object.fromEntries(
        rankedEmotions.map((entry) => [entry.emotion, round(entry.score)])
      ) as Record<EmotionLabel, number>,
      rankedEmotions,
      signals,
      attentionBand,
      pacing,
      messagingAngle,
      ctaStyle,
      fatigueRisk: round(fatigueRisk),
      opportunityScore: round(opportunityScore),
      explanation: [
        `Primary emotion ${top.emotion} with ${round(confidence * 100, 1)}% confidence.`,
        `Attention band resolved to ${attentionBand} from audience and behavioral evidence.`,
        `Top emotion mix: ${summarizeRankedEmotions(rankedEmotions).join(", ")}.`
      ]
    };
  }

  private buildSignals(input: EmotionDetectionInput): BehavioralSignal[] {
    const pointerVelocity = average((input.interaction.pointerSamples ?? []).map((sample) => {
      const distance = Math.abs(sample.dx) + Math.abs(sample.dy);
      return sample.dtMs <= 0 ? distance : distance / sample.dtMs;
    }));
    const scrollVelocity = average((input.interaction.scrollSamples ?? []).map((sample) => Math.abs(sample.velocity)));
    const averageScrollDwell = average((input.interaction.scrollSamples ?? []).map((sample) => sample.dwellMs));
    const hoverDepth = normalizeRate(input.interaction.hoverTargets, 12);
    const formCuriosity = normalizeRate(input.interaction.formInteractions, 6);
    const keyIntent = normalizeRate(input.interaction.keyEvents, 18);
    const mediaEngagement = normalizeRate(input.interaction.mediaPlayheadMs ?? 0, 60_000);
    const focusDepth = normalizeRate(input.interaction.focusDurationMs, 90_000);
    const rageSignal = normalizeRate(input.interaction.rageClicks, 6);
    const frictionSignal = normalizeRate(input.interaction.copyPasteEvents + input.interaction.rageClicks, 8);
    const scrollCommitment = clamp((input.interaction.scrollDepth + normalizeRate(averageScrollDwell, 4_500)) / 2, 0, 1);
    const exploration = clamp(
      average([
        normalizeRate(input.interaction.pointerEvents, 120),
        normalizeRate(pointerVelocity, 1.2),
        hoverDepth,
        scrollCommitment,
        formCuriosity
      ]),
      0,
      1
    );
    const purchaseReadiness = clamp(
      average([
        input.audience.intentScore,
        input.audience.conversionRate,
        keyIntent,
        formCuriosity,
        mediaEngagement,
        input.audience.purchasePowerIndex ?? 0.5
      ]),
      0,
      1
    );
    const immersion = clamp(
      average([
        focusDepth,
        scrollCommitment,
        normalizeRate(averageScrollDwell, 6_500),
        input.bciMetrics?.averageCompositeScore ?? input.audience.attentionScore ?? 0.5,
        mediaEngagement
      ]),
      0,
      1
    );
    const fatigue = clamp(
      average([
        input.audience.fatigueScore ?? 0.3,
        normalizeRate(input.history?.recentImpressions ?? 0, 20),
        normalizeRate(input.history?.recentClicks ?? 0, 10),
        normalizeRate(input.interaction.focusDurationMs, 180_000),
        normalizeRate(scrollVelocity, 5.5)
      ]),
      0,
      1
    );
    const trustSeek = clamp(
      average([
        frictionSignal,
        normalizeRate(input.history?.recentConversions ?? 0, 4),
        input.audience.familiarityScore ?? 0.4,
        input.history?.previousEmotion === "skeptical" ? 0.9 : 0.25
      ]),
      0,
      1
    );

    return [
      signal(
        "exploration",
        "Exploration",
        exploration,
        exploration,
        "Higher when pointer, hover, and scroll activity suggest active discovery.",
        exploration > 0.62 ? "up" : exploration < 0.32 ? "down" : "flat"
      ),
      signal(
        "purchase-readiness",
        "Purchase readiness",
        purchaseReadiness,
        purchaseReadiness,
        "Rises when intent, conversion propensity, and form interaction move together.",
        purchaseReadiness > 0.62 ? "up" : purchaseReadiness < 0.32 ? "down" : "flat"
      ),
      signal(
        "immersion",
        "Immersion",
        immersion,
        immersion,
        "Uses focus depth, dwell, and BCI composite attention to infer sustained attention.",
        immersion > 0.65 ? "up" : immersion < 0.35 ? "down" : "flat"
      ),
      signal(
        "friction",
        "Friction",
        frictionSignal,
        frictionSignal,
        "Rage clicks and copy/paste bursts raise signs of hesitation or frustration.",
        frictionSignal > 0.58 ? "up" : frictionSignal < 0.28 ? "down" : "flat"
      ),
      signal(
        "fatigue",
        "Fatigue",
        fatigue,
        fatigue,
        "Combines repeated exposure, long sessions, and interaction velocity to infer saturation.",
        fatigue > 0.58 ? "up" : fatigue < 0.28 ? "down" : "flat"
      ),
      signal(
        "trust-seeking",
        "Trust seeking",
        trustSeek,
        trustSeek,
        "Elevated when the audience may need reassurance, guarantees, and social proof.",
        trustSeek > 0.58 ? "up" : trustSeek < 0.28 ? "down" : "flat"
      ),
      signal(
        "rage",
        "Rage indicator",
        rageSignal,
        rageSignal,
        "Explicit rage-click behavior is treated as the strongest frustration cue.",
        rageSignal > 0.42 ? "up" : rageSignal < 0.14 ? "down" : "flat"
      )
    ];
  }

  private scoreEmotions(
    input: EmotionDetectionInput,
    signals: BehavioralSignal[]
  ): Record<EmotionLabel, number> {
    const read = (id: string): number => signals.find((entry) => entry.id === id)?.normalized ?? 0;
    const exploration = read("exploration") * this.tuning.explorationWeight;
    const purchaseReadiness = read("purchase-readiness") * this.tuning.purchaseWeight;
    const immersion = read("immersion") * this.tuning.immersionWeight;
    const friction = read("friction");
    const fatigue = read("fatigue") * this.tuning.fatigueWeight;
    const trustSeek = read("trust-seeking");
    const rage = read("rage") * this.tuning.rageWeight;
    const attention = input.audience.attentionScore ?? input.bciMetrics?.averageAttention ?? 0.5;
    const familiarity = input.audience.familiarityScore ?? 0.4;
    const upliftFromHistory = clamp((input.history?.priorAttentionDelta ?? 0) * 0.5 + 0.5, 0, 1);

    return {
      curious: clamp(average([exploration, 1 - rage, 1 - fatigue, 1 - purchaseReadiness * 0.4]), 0, 1),
      focused: clamp(average([immersion, attention, 1 - fatigue * 0.7, input.audience.intentScore]), 0, 1),
      excited: clamp(average([exploration, purchaseReadiness, upliftFromHistory, attention]), 0, 1),
      delighted: clamp(average([immersion, familiarity, 1 - friction, 1 - fatigue, upliftFromHistory]), 0, 1),
      skeptical: clamp(average([trustSeek, friction, 1 - purchaseReadiness * 0.45, familiarity]), 0, 1),
      frustrated: clamp(average([rage, friction, fatigue, 1 - attention]), 0, 1),
      overwhelmed: clamp(average([fatigue, exploration, 1 - attention, friction]), 0, 1),
      "ready-to-convert": clamp(average([purchaseReadiness, attention, input.audience.conversionRate, 1 - fatigue]), 0, 1),
      neutral: clamp(average([0.45, 1 - Math.abs(exploration - 0.5), 1 - Math.abs(attention - 0.5)]), 0, 1)
    };
  }

  private resolveAttentionBand(
    input: EmotionDetectionInput,
    signals: BehavioralSignal[]
  ): AttentionBand {
    const explicitAttention = input.audience.attentionScore ?? input.bciMetrics?.averageAttention ?? 0.5;
    const behaviorAttention = average([
      signals.find((entry) => entry.id === "immersion")?.normalized ?? 0,
      signals.find((entry) => entry.id === "purchase-readiness")?.normalized ?? 0,
      1 - (signals.find((entry) => entry.id === "fatigue")?.normalized ?? 0)
    ]);
    return toAttentionBand(average([explicitAttention, behaviorAttention]));
  }

  private resolvePacing(
    emotion: EmotionLabel,
    attentionBand: AttentionBand
  ): EmotionInference["pacing"] {
    if (emotion === "skeptical" || emotion === "overwhelmed" || emotion === "frustrated") {
      return "calm";
    }
    if (emotion === "excited" && attentionBand !== "glance") {
      return "fast";
    }
    return "balanced";
  }

  private resolveMessagingAngle(
    emotion: EmotionLabel,
    intentScore: number
  ): MessagingAngle {
    switch (emotion) {
      case "curious":
        return "education-led";
      case "focused":
        return intentScore >= 0.6 ? "benefit-led" : "proof-led";
      case "excited":
      case "ready-to-convert":
        return "urgency-led";
      case "skeptical":
      case "overwhelmed":
      case "frustrated":
        return "reassurance-led";
      case "delighted":
        return "community-led";
      default:
        return "benefit-led";
    }
  }
}
