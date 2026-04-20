/**
 * FocusAggregator
 *
 * Aggregates on-device engagement telemetry into an abstract attention-depth
 * score. Raw telemetry samples are never retained after aggregation.
 *
 * Calibration notes:
 * - Pause-duration midpoint and interaction caps are tuned to separate
 *   quick-feed scanning from sustained focus.
 * - Confidence starts conservative, then increases with stable sample volume.
 */

export type AttentionDepth = "fragmented" | "steady" | "deep";

export interface FocusSignal {
  scrollPauseMs: number;
  interactionCount: number;
  sampleWindowMs?: number;
}

export interface FocusSnapshot {
  attentionDepthScore: number;
  attentionDepth: AttentionDepth;
  confidence: number;
  samplesProcessed: number;
  computedAt: string;
}

const DEFAULT_WINDOW_MS = 5_000;
// ~2.2s pause is a practical midpoint between scanning and deep-reading behavior.
const PAUSE_DURATION_KNEE_MS = 2_200;
// Interactions/min above this value are capped to avoid over-rewarding noisy sessions.
const MAX_INTERACTIONS_PER_MINUTE = 18;
const WARMUP_SAMPLE_COUNT = 8;
const WARMUP_SMOOTHING_FACTOR = 0.35;
const STEADY_SMOOTHING_FACTOR = 0.2;
const PAUSE_WEIGHT = 0.58;
const INTERACTION_WEIGHT = 0.42;
const MAX_CONFIDENCE = 0.98;
const BASE_CONFIDENCE = 0.35;
const CONFIDENCE_GROWTH_PER_SAMPLE = 0.08;
const VOLATILITY_CONFIDENCE_PENALTY = 0.7;
const MIN_CONFIDENCE = 0.2;
const SYNTHETIC_SNAPSHOT_CONFIDENCE = 0.45;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sigmoid(value: number, knee: number): number {
  if (value <= 0) return 0;
  return value / (value + knee);
}

function classifyAttentionDepth(score: number): AttentionDepth {
  if (score < 0.4) return "fragmented";
  if (score < 0.7) return "steady";
  return "deep";
}

export class FocusAggregator {
  private pauseEma = 0.5;
  private interactionEma = 0.5;
  private volatilityEma = 0.3;
  private samples = 0;
  private lastScore = 0.5;

  ingest(signal: FocusSignal): FocusSnapshot {
    const windowMs = signal.sampleWindowMs ?? DEFAULT_WINDOW_MS;
    const pauseScore = clamp(sigmoid(signal.scrollPauseMs, PAUSE_DURATION_KNEE_MS), 0, 1);
    const interactionsPerMinute = windowMs > 0
      ? signal.interactionCount * (60_000 / windowMs)
      : 0;
    const interactionScore = clamp(interactionsPerMinute / MAX_INTERACTIONS_PER_MINUTE, 0, 1);

    this.samples += 1;
    const smoothing = this.samples < WARMUP_SAMPLE_COUNT
      ? WARMUP_SMOOTHING_FACTOR
      : STEADY_SMOOTHING_FACTOR;
    this.pauseEma = this.pauseEma + (pauseScore - this.pauseEma) * smoothing;
    this.interactionEma = this.interactionEma + (interactionScore - this.interactionEma) * smoothing;

    const score = clamp(PAUSE_WEIGHT * this.pauseEma + INTERACTION_WEIGHT * this.interactionEma, 0, 1);
    const delta = Math.abs(score - this.lastScore);
    this.volatilityEma = this.volatilityEma + (delta - this.volatilityEma) * 0.25;
    this.lastScore = score;

    const confidence = clamp(
      Math.min(MAX_CONFIDENCE, BASE_CONFIDENCE + this.samples * CONFIDENCE_GROWTH_PER_SAMPLE) *
      (1 - this.volatilityEma * VOLATILITY_CONFIDENCE_PENALTY),
      MIN_CONFIDENCE,
      MAX_CONFIDENCE
    );

    return {
      attentionDepthScore: score,
      attentionDepth: classifyAttentionDepth(score),
      confidence,
      samplesProcessed: this.samples,
      computedAt: new Date().toISOString()
    };
  }

  snapshotFromAttentionScore(attentionScore: number): FocusSnapshot {
    const score = clamp(attentionScore, 0, 1);
    return {
      attentionDepthScore: score,
      attentionDepth: classifyAttentionDepth(score),
      confidence: SYNTHETIC_SNAPSHOT_CONFIDENCE,
      samplesProcessed: this.samples,
      computedAt: new Date().toISOString()
    };
  }
}

export const focusAggregator = new FocusAggregator();
