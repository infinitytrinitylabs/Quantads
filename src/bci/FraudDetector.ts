import { BiometricSample } from "./AttentionStore";

export type FraudVerdict = "clean" | "suspicious" | "fraud";

export interface FraudAnalysis {
  verdict: FraudVerdict;
  fraudScore: number;     // 0.0 (clean) – 1.0 (certain fraud)
  flags: string[];
}

// Physiological plausibility bounds
const HR_MIN = 30;
const HR_MAX = 220;
const EYE_MIN = 0;
const EYE_MAX = 1;
const NEURAL_MIN = 0;
const NEURAL_MAX = 1;

// Thresholds
const MIN_SAMPLES_FOR_VARIANCE = 4;
const LOW_VARIANCE_THRESHOLD = 0.0001;    // suspiciously constant signal
const MAX_HR_DELTA_PER_SAMPLE = 15;       // bpm change between consecutive samples
const SUSPICIOUS_THRESHOLD = 0.4;
const FRAUD_THRESHOLD = 0.75;

function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
}

/**
 * Statistical fraud detector for BCI biometric streams.
 *
 * Runs the following checks:
 *  1. Out-of-range bounds (physiologically impossible values)
 *  2. Near-zero variance (synthetic constant signal from bots)
 *  3. Impossible heart-rate delta between consecutive samples
 *  4. Monotonic signal detection (only ever increases or only ever decreases)
 *  5. Cross-signal coherence (eye-tracking and neural activity must not be perfectly correlated)
 */
export function detectFraud(samples: BiometricSample[]): FraudAnalysis {
  const flags: string[] = [];
  let fraudScore = 0;

  if (samples.length === 0) {
    return { verdict: "clean", fraudScore: 0, flags: [] };
  }

  // ── 1. Out-of-range check ──────────────────────────────────────────────────
  for (const s of samples) {
    if (s.heartRate < HR_MIN || s.heartRate > HR_MAX) {
      flags.push(`out-of-range:heartRate:${s.heartRate}`);
      fraudScore = Math.max(fraudScore, 0.9);
    }
    if (s.eyeTrackingScore < EYE_MIN || s.eyeTrackingScore > EYE_MAX) {
      flags.push(`out-of-range:eyeTrackingScore:${s.eyeTrackingScore}`);
      fraudScore = Math.max(fraudScore, 0.9);
    }
    if (s.neuralActivity < NEURAL_MIN || s.neuralActivity > NEURAL_MAX) {
      flags.push(`out-of-range:neuralActivity:${s.neuralActivity}`);
      fraudScore = Math.max(fraudScore, 0.9);
    }
  }

  // ── 2. Near-zero variance (bot replay) ────────────────────────────────────
  if (samples.length >= MIN_SAMPLES_FOR_VARIANCE) {
    const hrVar = variance(samples.map((s) => s.heartRate));
    const eyeVar = variance(samples.map((s) => s.eyeTrackingScore));
    const neuralVar = variance(samples.map((s) => s.neuralActivity));

    if (hrVar < LOW_VARIANCE_THRESHOLD) {
      flags.push("low-variance:heartRate");
      fraudScore = Math.max(fraudScore, 0.8);
    }
    if (eyeVar < LOW_VARIANCE_THRESHOLD) {
      flags.push("low-variance:eyeTrackingScore");
      fraudScore = Math.max(fraudScore, 0.65);
    }
    if (neuralVar < LOW_VARIANCE_THRESHOLD) {
      flags.push("low-variance:neuralActivity");
      fraudScore = Math.max(fraudScore, 0.65);
    }
  }

  // ── 3. Impossible heart-rate delta between consecutive samples ─────────────
  for (let i = 1; i < samples.length; i++) {
    const currentHr = samples[i]?.heartRate;
    const prevHr = samples[i - 1]?.heartRate;
    // Only check delta if both samples have valid heart rate data
    if (currentHr !== undefined && prevHr !== undefined && currentHr > 0 && prevHr > 0) {
      const delta = Math.abs(currentHr - prevHr);
      if (delta > MAX_HR_DELTA_PER_SAMPLE) {
        flags.push(`impossible-hr-delta:${delta}bpm`);
        fraudScore = Math.max(fraudScore, 0.85);
      }
    }
  }

  // ── 4. Monotonic signal (physiologically unrealistic) ─────────────────────
  if (samples.length >= MIN_SAMPLES_FOR_VARIANCE) {
    const hrValues = samples.map((s) => s.heartRate);
    const allIncreasing = hrValues.every((v, i) => i === 0 || v >= (hrValues[i - 1] ?? 0));
    const allDecreasing = hrValues.every((v, i) => i === 0 || v <= (hrValues[i - 1] ?? 0));
    if (allIncreasing || allDecreasing) {
      flags.push("monotonic:heartRate");
      fraudScore = Math.max(fraudScore, 0.55);
    }
  }

  // ── 5. Perfect cross-signal correlation (copy-paste spoof) ────────────────
  if (samples.length >= MIN_SAMPLES_FOR_VARIANCE) {
    const eyeValues = samples.map((s) => s.eyeTrackingScore);
    const neuralValues = samples.map((s) => s.neuralActivity);
    const identical = eyeValues.every((v, i) => v === neuralValues[i]);
    if (identical) {
      flags.push("perfect-correlation:eye-neural");
      fraudScore = Math.max(fraudScore, 0.7);
    }
  }

  // Deduplicate flag prefixes to avoid repetition in short streams
  const uniqueFlags = [...new Set(flags)];

  let verdict: FraudVerdict = "clean";
  if (fraudScore >= FRAUD_THRESHOLD) {
    verdict = "fraud";
  } else if (fraudScore >= SUSPICIOUS_THRESHOLD) {
    verdict = "suspicious";
  }

  return { verdict, fraudScore: Number(fraudScore.toFixed(4)), flags: uniqueFlags };
}
