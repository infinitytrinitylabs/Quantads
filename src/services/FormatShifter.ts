export type DeliveryMode = "narrative-longform" | "micro-burst";

export interface DeliveryPlan {
  mode: DeliveryMode;
  maxDurationSeconds: number;
  pacingMultiplier: number;
  visualResonance: "cinematic" | "high-impact";
  rationale: string[];
}

export interface FormatShiftInput {
  attentionDepthScore: number;
  previousMode?: DeliveryMode;
  skipRate?: number;
}

const SKIP_RATE_PENALTY = 0.25;
// At ~68% effective focus, users can sustain longer narrative creative reliably.
const NARRATIVE_THRESHOLD = 0.68;
// Hysteresis prevents rapid oscillation once narrative mode is active.
const NARRATIVE_HYSTERESIS_THRESHOLD = 0.6;

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

export class FormatShifter {
  selectDelivery(input: FormatShiftInput): DeliveryPlan {
    const score = clamp(input.attentionDepthScore, 0, 1);
    const skipRate = clamp(input.skipRate ?? 0, 0, 1);
    const effectiveScore = clamp(score - skipRate * SKIP_RATE_PENALTY, 0, 1);
    const rationale = [
      `Attention depth score: ${(effectiveScore * 100).toFixed(0)}%`,
      `Skip pressure: ${(skipRate * 100).toFixed(0)}%`
    ];

    if (
      effectiveScore >= NARRATIVE_THRESHOLD ||
      (input.previousMode === "narrative-longform" && effectiveScore >= NARRATIVE_HYSTERESIS_THRESHOLD)
    ) {
      return {
        mode: "narrative-longform",
        maxDurationSeconds: 12,
        pacingMultiplier: 0.85,
        visualResonance: "cinematic",
        rationale: [...rationale, "Deep attention detected; deliver narrative-driven creative."]
      };
    }

    return {
      mode: "micro-burst",
      maxDurationSeconds: 2.8,
      pacingMultiplier: 1.25,
      visualResonance: "high-impact",
      rationale: [...rationale, "Fragmented/volatile attention detected; switch to sub-3s burst creative."]
    };
  }
}

export const formatShifter = new FormatShifter();
