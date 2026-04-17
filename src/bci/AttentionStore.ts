export interface BiometricSample {
  eyeTrackingScore: number;   // 0.0–1.0 fixation quality
  heartRate: number;          // bpm
  neuralActivity: number;     // 0.0–1.0 EEG engagement index
  recordedAt: string;         // ISO-8601
}

export interface AttentionWindow {
  userId: string;
  samples: BiometricSample[];
  aggregated: AggregatedAttention;
  lastUpdatedAt: string;
}

export interface AggregatedAttention {
  attentionScore: number;   // 0.0–1.0 composite
  sampleCount: number;
  averageHeartRate: number;
  averageEyeTracking: number;
  averageNeuralActivity: number;
  windowSeconds: number;
}

const WINDOW_SECONDS = 30;
const MAX_SAMPLES_PER_USER = 300; // ring-buffer cap per user

const round4 = (v: number): number => Number(v.toFixed(4));

/** Weights for composite attention score */
const W_EYE = 0.45;
const W_NEURAL = 0.40;
const W_HR = 0.15; // normalised heart-rate engagement contribution

function computeAttentionScore(samples: BiometricSample[]): AggregatedAttention {
  if (samples.length === 0) {
    return {
      attentionScore: 0,
      sampleCount: 0,
      averageHeartRate: 0,
      averageEyeTracking: 0,
      averageNeuralActivity: 0,
      windowSeconds: WINDOW_SECONDS
    };
  }

  const n = samples.length;
  let sumEye = 0;
  let sumHr = 0;
  let sumNeural = 0;

  for (const s of samples) {
    sumEye += s.eyeTrackingScore;
    sumHr += s.heartRate;
    sumNeural += s.neuralActivity;
  }

  const avgEye = sumEye / n;
  const avgHr = sumHr / n;
  const avgNeural = sumNeural / n;

  // Normalize heart rate: resting ~60 bpm, peak engagement ~90+ bpm.
  // Map [60,90] → [0,1], clamp outside range.
  const hrNorm = Math.min(Math.max((avgHr - 60) / 30, 0), 1);

  const attentionScore = round4(
    Math.min(
      W_EYE * avgEye + W_NEURAL * avgNeural + W_HR * hrNorm,
      1
    )
  );

  return {
    attentionScore,
    sampleCount: n,
    averageHeartRate: round4(avgHr),
    averageEyeTracking: round4(avgEye),
    averageNeuralActivity: round4(avgNeural),
    windowSeconds: WINDOW_SECONDS
  };
}

export class AttentionStore {
  private readonly windows = new Map<string, AttentionWindow>();

  ingest(userId: string, sample: BiometricSample): AttentionWindow {
    let window = this.windows.get(userId);

    if (!window) {
      window = {
        userId,
        samples: [],
        aggregated: computeAttentionScore([]),
        lastUpdatedAt: sample.recordedAt
      };
      this.windows.set(userId, window);
    }

    // Evict samples older than WINDOW_SECONDS
    const cutoff = new Date(sample.recordedAt).getTime() - WINDOW_SECONDS * 1000;
    window.samples = window.samples.filter(
      (s) => new Date(s.recordedAt).getTime() >= cutoff
    );

    // Ring-buffer cap: drop oldest if at max
    if (window.samples.length >= MAX_SAMPLES_PER_USER) {
      window.samples.shift();
    }

    window.samples.push(sample);
    window.aggregated = computeAttentionScore(window.samples);
    window.lastUpdatedAt = sample.recordedAt;

    return window;
  }

  getAggregated(userId: string): AggregatedAttention | null {
    return this.windows.get(userId)?.aggregated ?? null;
  }

  getWindow(userId: string): AttentionWindow | null {
    return this.windows.get(userId) ?? null;
  }

  /** Returns all user IDs with active attention windows */
  activeUserIds(): string[] {
    return [...this.windows.keys()];
  }
}

export const attentionStore = new AttentionStore();
