/**
 * EmotionDetector — infers a user's emotional state purely from behavioural
 * signals (scroll speed, click patterns, dwell time, idle duration).
 *
 * No camera or BCI hardware is required.  All estimates are updated every 5 s
 * via a rolling-window approach so stale signals expire naturally.
 */

export type EmotionalState = "happy" | "neutral" | "bored" | "frustrated";

export interface BehaviouralSample {
  /** unix epoch ms */
  timestamp: number;
  /** pixels per second — fast scroll → boredom signal */
  scrollSpeed: number;
  /** normalised erraticity [0-1] — high variance in mouse/touch velocity */
  clickErraticity: number;
  /** seconds the user spent on the current content element */
  dwellTimeSeconds: number;
  /** seconds since the last user interaction (mouse, touch, key) */
  idleSeconds: number;
}

export interface EmotionEstimate {
  state: EmotionalState;
  /** confidence in [0, 1] */
  confidence: number;
  /** attention score derived alongside emotion [0, 1] */
  attentionScore: number;
  /** ISO-8601 timestamp when this estimate was produced */
  computedAt: string;
  /** raw feature vector for debugging/transparency */
  features: {
    meanScrollSpeed: number;
    meanClickErraticity: number;
    meanDwellTime: number;
    meanIdleSeconds: number;
    sampleCount: number;
  };
}

interface WindowOptions {
  /** width of the rolling window in milliseconds (default: 30 000) */
  windowMs?: number;
  /** interval between auto-updates in milliseconds (default: 5 000) */
  updateIntervalMs?: number;
}

interface Scheduler {
  setInterval(handler: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const DEFAULTS: Required<WindowOptions> = {
  windowMs: 30_000,
  updateIntervalMs: 5_000
};

/** Clamp a value to [lo, hi]. */
function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/** Arithmetic mean of an array; returns 0 for empty arrays. */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Sigmoid-style normaliser that maps a positive scalar to [0, 1].
 * knee controls the value that maps to ~0.5.
 */
function sigmoid(value: number, knee: number): number {
  return value / (value + knee);
}

// ─── Scoring constants ────────────────────────────────────────────────────────

// Scroll speed thresholds (px/s)
const SCROLL_FAST_THRESHOLD = 1_500; // above → boredom
const SCROLL_SLOW_THRESHOLD = 200;   // below → engagement or idle

// Click erraticity threshold
const CLICK_ERRATIC_THRESHOLD = 0.6; // above → frustration

// Dwell time thresholds (s)
const DWELL_INTERESTED_THRESHOLD = 8; // above → happy/interested
const DWELL_BORED_THRESHOLD = 2;      // below → bored

// Idle thresholds (s)
const IDLE_LONG_THRESHOLD = 20;       // above → gone / attention very low
const IDLE_MEDIUM_THRESHOLD = 8;      // above → reducing attention

// ─── Emotion inference ────────────────────────────────────────────────────────

function inferEmotion(features: EmotionEstimate["features"]): {
  state: EmotionalState;
  confidence: number;
} {
  const { meanScrollSpeed, meanClickErraticity, meanDwellTime, meanIdleSeconds, sampleCount } = features;

  // Not enough data — default to neutral with low confidence
  if (sampleCount < 2) {
    return { state: "neutral", confidence: 0.4 };
  }

  // Frustration: erratic clicking dominates
  if (meanClickErraticity > CLICK_ERRATIC_THRESHOLD) {
    const confidence = clamp(0.5 + (meanClickErraticity - CLICK_ERRATIC_THRESHOLD) * 2, 0.5, 0.95);
    return { state: "frustrated", confidence };
  }

  // Boredom: fast scrolling and/or very short dwell times
  const isFastScrolling = meanScrollSpeed > SCROLL_FAST_THRESHOLD;
  const isShortDwell = meanDwellTime < DWELL_BORED_THRESHOLD && meanDwellTime > 0;
  if (isFastScrolling || isShortDwell) {
    const scrollSignal = clamp(sigmoid(meanScrollSpeed - SCROLL_FAST_THRESHOLD, 500), 0, 1);
    const dwellSignal = isShortDwell ? 1 - meanDwellTime / DWELL_BORED_THRESHOLD : 0;
    const raw = Math.max(scrollSignal, dwellSignal);
    const confidence = clamp(0.5 + raw * 0.45, 0.5, 0.92);
    return { state: "bored", confidence };
  }

  // Happy / interested: long dwell and slow scroll
  const isLongDwell = meanDwellTime >= DWELL_INTERESTED_THRESHOLD;
  const isSlowScroll = meanScrollSpeed <= SCROLL_SLOW_THRESHOLD;
  if (isLongDwell || (isSlowScroll && meanIdleSeconds < IDLE_MEDIUM_THRESHOLD)) {
    const dwellSignal = sigmoid(meanDwellTime - DWELL_INTERESTED_THRESHOLD, 5);
    const confidence = clamp(0.55 + dwellSignal * 0.4, 0.55, 0.92);
    return { state: "happy", confidence };
  }

  // Default neutral
  return { state: "neutral", confidence: 0.65 };
}

// ─── Attention score ──────────────────────────────────────────────────────────

function computeAttention(features: EmotionEstimate["features"]): number {
  const { meanScrollSpeed, meanDwellTime, meanIdleSeconds, sampleCount } = features;

  if (sampleCount === 0) return 0.5;

  // Long idle → attention collapses
  if (meanIdleSeconds >= IDLE_LONG_THRESHOLD) {
    return clamp(0.1 + 0.2 * (1 - (meanIdleSeconds - IDLE_LONG_THRESHOLD) / 30), 0.05, 0.3);
  }

  // Three sub-scores combined:
  // 1. dwell score — longer dwell → higher attention
  const dwellScore = clamp(sigmoid(meanDwellTime, 6), 0, 1);

  // 2. scroll score — fast scroll → low attention
  const scrollScore = 1 - clamp(sigmoid(meanScrollSpeed, 800), 0, 1);

  // 3. idle score — moderate idle can be fine (reading), long is bad
  const idleScore =
    meanIdleSeconds < IDLE_MEDIUM_THRESHOLD
      ? 1 - meanIdleSeconds / IDLE_MEDIUM_THRESHOLD
      : 0;

  const raw = 0.5 * dwellScore + 0.3 * scrollScore + 0.2 * idleScore;
  return clamp(raw, 0, 1);
}

// ─── EmotionDetector ─────────────────────────────────────────────────────────

export class EmotionDetector {
  private readonly windowMs: number;
  private readonly samples: BehaviouralSample[] = [];
  private lastEstimate: EmotionEstimate;
  private intervalHandle: unknown = null;
  private readonly scheduler: Scheduler;

  constructor(options: WindowOptions & { scheduler?: Scheduler } = {}) {
    this.windowMs = options.windowMs ?? DEFAULTS.windowMs;
    const updateIntervalMs = options.updateIntervalMs ?? DEFAULTS.updateIntervalMs;

    this.scheduler = options.scheduler ?? {
      setInterval: (handler, ms) => {
        const handle = setInterval(handler, ms);
        // unref() prevents the timer from keeping the Node.js process alive when
        // all other work is done (e.g. after all tests have completed).
        if (typeof (handle as { unref?: () => void }).unref === "function") {
          (handle as { unref: () => void }).unref();
        }
        return handle;
      },
      clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>)
    };

    // Seed with a neutral estimate
    this.lastEstimate = this.buildEstimate(Date.now());

    this.intervalHandle = this.scheduler.setInterval(() => {
      this.lastEstimate = this.buildEstimate(Date.now());
    }, updateIntervalMs);
  }

  /** Feed a new behavioural sample into the rolling window. */
  ingest(sample: BehaviouralSample): void {
    this.samples.push(sample);
    this.evict(sample.timestamp);
  }

  /** Convenience: create a sample from raw interaction deltas. */
  ingestRaw(args: {
    scrollDeltaPx: number;
    elapsedMs: number;
    clickCount: number;
    clickJitterMs: number;
    dwellTimeSeconds: number;
    idleSeconds: number;
  }): void {
    const scrollSpeed = args.elapsedMs > 0
      ? (Math.abs(args.scrollDeltaPx) / args.elapsedMs) * 1_000
      : 0;

    // erraticity: ratio of click jitter to a baseline 300 ms
    const clickErraticity = args.clickCount > 0
      ? clamp(args.clickJitterMs / 300, 0, 1)
      : 0;

    this.ingest({
      timestamp: Date.now(),
      scrollSpeed,
      clickErraticity,
      dwellTimeSeconds: args.dwellTimeSeconds,
      idleSeconds: args.idleSeconds
    });
  }

  /** Return the most recent emotion estimate (computed every 5 s). */
  getLatestEstimate(): EmotionEstimate {
    return this.lastEstimate;
  }

  /** Force an immediate estimate without waiting for the next tick. */
  computeNow(): EmotionEstimate {
    this.lastEstimate = this.buildEstimate(Date.now());
    return this.lastEstimate;
  }

  /** Stop the background update interval. */
  destroy(): void {
    if (this.intervalHandle !== null) {
      this.scheduler.clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private evict(now: number): void {
    const cutoff = now - this.windowMs;
    let i = 0;
    while (i < this.samples.length && this.samples[i]!.timestamp < cutoff) {
      i++;
    }
    if (i > 0) this.samples.splice(0, i);
  }

  private buildEstimate(now: number): EmotionEstimate {
    this.evict(now);
    const window = this.samples;

    const features: EmotionEstimate["features"] = {
      meanScrollSpeed: mean(window.map((s) => s.scrollSpeed)),
      meanClickErraticity: mean(window.map((s) => s.clickErraticity)),
      meanDwellTime: mean(window.map((s) => s.dwellTimeSeconds)),
      meanIdleSeconds: mean(window.map((s) => s.idleSeconds)),
      sampleCount: window.length
    };

    const { state, confidence } = inferEmotion(features);
    const attentionScore = computeAttention(features);

    return {
      state,
      confidence,
      attentionScore,
      computedAt: new Date(now).toISOString(),
      features
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const emotionDetector = new EmotionDetector();
