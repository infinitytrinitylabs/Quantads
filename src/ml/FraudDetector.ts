/**
 * FraudDetector – Isolation Forest anomaly detection in pure TypeScript.
 *
 * Isolation Forest (Liu et al., 2008) works by building an ensemble of random
 * isolation trees. Anomalies (fraud) are isolated in fewer splits than normal
 * samples, yielding a higher anomaly score.
 *
 * Features scored:
 *   clickRate          – clicks / impressions (0–1+; normal < 0.1)
 *   avgDwellTime       – average dwell time in ms (normal: 2000–30 000)
 *   attentionVariance  – variance of attention scores (bots → near 0)
 *   uniqueIpCount      – distinct source IPs in window
 *   sessionDuration    – session length in ms
 *
 * Score thresholds:
 *   > 0.85 → "suspicious"
 *   > 0.95 → "blocked" (auto-refund triggered)
 */

import { randomUUID } from "node:crypto";
import { FraudFeatures, FraudAlert } from "../types";
import { roundToDecimals } from "../lib/mathUtils";

// ── Isolation Tree ────────────────────────────────────────────────────────────

interface ITreeNode {
  isLeaf: boolean;
  size: number;        // number of samples in this node (leaf)
  splitFeature: number;
  splitValue: number;
  left: ITreeNode | null;
  right: ITreeNode | null;
}

/** Build one isolation tree from a sample of feature vectors. */
function buildITree(data: number[][], heightLimit: number, currentHeight = 0): ITreeNode {
  const n = data.length;
  const featureCount = data[0]?.length ?? FEATURE_COUNT;

  if (n <= 1 || currentHeight >= heightLimit) {
    return { isLeaf: true, size: n, splitFeature: 0, splitValue: 0, left: null, right: null };
  }

  // Pick a random feature
  const splitFeature = Math.floor(Math.random() * featureCount);

  // Find the range of the chosen feature
  let min = data[0][splitFeature];
  let max = data[0][splitFeature];
  for (let i = 1; i < n; i++) {
    const v = data[i][splitFeature];
    if (v < min) min = v;
    if (v > max) max = v;
  }

  if (min === max) {
    // All values identical – treat as leaf
    return { isLeaf: true, size: n, splitFeature, splitValue: min, left: null, right: null };
  }

  const splitValue = min + Math.random() * (max - min);

  const leftData: number[][] = [];
  const rightData: number[][] = [];
  for (const row of data) {
    if (row[splitFeature] < splitValue) {
      leftData.push(row);
    } else {
      rightData.push(row);
    }
  }

  return {
    isLeaf: false,
    size: n,
    splitFeature,
    splitValue,
    left: buildITree(leftData, heightLimit, currentHeight + 1),
    right: buildITree(rightData, heightLimit, currentHeight + 1)
  };
}

/** Compute path length for a single sample through one isolation tree. */
function pathLength(tree: ITreeNode, sample: number[], currentHeight = 0): number {
  if (tree.isLeaf) {
    return currentHeight + averagePathLength(tree.size);
  }
  if (sample[tree.splitFeature] < tree.splitValue) {
    return pathLength(tree.left!, sample, currentHeight + 1);
  }
  return pathLength(tree.right!, sample, currentHeight + 1);
}

/**
 * Expected average path length in a BST for n samples.
 * c(n) = 2 * H(n-1) - (2*(n-1)/n)   where H is the harmonic number.
 */
function averagePathLength(n: number): number {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  return 2 * harmonicNumber(n - 1) - (2 * (n - 1)) / n;
}

/** Harmonic number H(n) ≈ ln(n) + 0.5772 */
function harmonicNumber(n: number): number {
  return Math.log(n) + 0.5772156649;
}

// ── Isolation Forest ──────────────────────────────────────────────────────────

const FEATURE_COUNT = 5;
const DEFAULT_N_TREES = 100;
const DEFAULT_SUBSAMPLE_SIZE = 256;

export class IsolationForest {
  private trees: ITreeNode[] = [];
  private nSamples = 0;
  private isTrained = false;

  constructor(
    private readonly nTrees = DEFAULT_N_TREES,
    private readonly subsampleSize = DEFAULT_SUBSAMPLE_SIZE
  ) {}

  /** Train the forest on a batch of historical feature vectors. */
  train(samples: number[][]): void {
    if (samples.length === 0) {
      throw new Error("Cannot train on empty dataset");
    }

    this.nSamples = samples.length;
    const heightLimit = Math.ceil(Math.log2(Math.min(this.subsampleSize, samples.length)));

    this.trees = [];
    for (let t = 0; t < this.nTrees; t++) {
      const sub = subsample(samples, this.subsampleSize);
      this.trees.push(buildITree(sub, heightLimit));
    }

    this.isTrained = true;
  }

  /**
   * Score a single sample.
   * Returns a value in (0, 1) where values near 1 indicate anomalies.
   */
  score(sample: number[]): number {
    if (!this.isTrained) {
      throw new Error("IsolationForest has not been trained yet");
    }

    const avgLen = this.trees.reduce((sum, tree) => sum + pathLength(tree, sample), 0) / this.trees.length;
    const c = averagePathLength(Math.min(this.subsampleSize, this.nSamples));
    if (c === 0) return 0.5;

    // anomaly score = 2^(−avgLen / c)
    return Math.pow(2, -(avgLen / c));
  }
}

// ── Random subsample helper ───────────────────────────────────────────────────

function subsample(data: number[][], size: number): number[][] {
  if (data.length <= size) return data.slice();
  const result: number[][] = [];
  const indices = new Set<number>();
  while (indices.size < size) {
    indices.add(Math.floor(Math.random() * data.length));
  }
  for (const i of indices) result.push(data[i]);
  return result;
}

// ── Feature normalisation ─────────────────────────────────────────────────────

/**
 * Normalise FraudFeatures into a fixed-length numeric vector.
 * Order: [clickRate, avgDwellTime, attentionVariance, uniqueIpCount, sessionDuration]
 */
function featuresToVector(f: FraudFeatures): number[] {
  return [
    f.clickRate,
    f.avgDwellTime / 1000,        // ms → s for better numeric scaling
    f.attentionVariance,
    f.uniqueIpCount,
    f.sessionDuration / 1000      // ms → s
  ];
}

// ── FraudDetector service ─────────────────────────────────────────────────────

const SUSPICIOUS_THRESHOLD = 0.85;
const BLOCK_THRESHOLD = 0.95;

export class FraudDetector {
  private readonly forest = new IsolationForest();
  private readonly alerts = new Map<string, FraudAlert>();

  /**
   * Train the anomaly detector on historical fraud features.
   * Must be called before `score()`.
   */
  trainOnHistoricalData(historicalFeatures: FraudFeatures[]): void {
    const vectors = historicalFeatures.map(featuresToVector);
    this.forest.train(vectors);
  }

  /**
   * Score a user's activity features.
   * Returns an anomaly score in (0, 1).
   */
  scoreFeatures(features: FraudFeatures): number {
    return this.forest.score(featuresToVector(features));
  }

  /**
   * Evaluate a user event and produce a FraudAlert.
   *
   * @param userId       Opaque user identifier.
   * @param features     Aggregated behavioural features for this user/window.
   * @param heuristicFlags  Optional list of heuristic flags from BotHeuristics.
   * @returns FraudAlert with verdict and auto-refund flag.
   */
  evaluate(userId: string, features: FraudFeatures, heuristicFlags: string[] = []): FraudAlert {
    const anomalyScore = this.forest.score(featuresToVector(features));

    let verdict: "clean" | "suspicious" | "blocked";
    let autoRefunded = false;

    if (anomalyScore > BLOCK_THRESHOLD || heuristicFlags.length >= 3) {
      verdict = "blocked";
      autoRefunded = true;
    } else if (anomalyScore > SUSPICIOUS_THRESHOLD || heuristicFlags.length >= 1) {
      verdict = "suspicious";
    } else {
      verdict = "clean";
    }

    const alert: FraudAlert = {
      id: randomUUID(),
      userId,
      anomalyScore: roundToDecimals(anomalyScore, 4),
      verdict,
      features,
      heuristicFlags,
      autoRefunded,
      createdAt: new Date().toISOString()
    };

    this.alerts.set(alert.id, alert);
    return alert;
  }

  getAlert(alertId: string): FraudAlert | null {
    return this.alerts.get(alertId) ?? null;
  }

  getAllAlerts(): FraudAlert[] {
    return Array.from(this.alerts.values());
  }

  getAlertsForUser(userId: string): FraudAlert[] {
    return Array.from(this.alerts.values()).filter((a) => a.userId === userId);
  }
}

// ── Module-level singleton ────────────────────────────────────────────────────

export const fraudDetector = new FraudDetector();

// ── Seed training data ────────────────────────────────────────────────────────

/**
 * Provide a minimal synthetic training set so the detector is ready at startup.
 * In production this would be seeded from a real historical dataset.
 */
const SYNTHETIC_TRAINING_DATA: FraudFeatures[] = [
  // Normal users
  { clickRate: 0.03, avgDwellTime: 8500, attentionVariance: 0.12, uniqueIpCount: 1, sessionDuration: 180000 },
  { clickRate: 0.05, avgDwellTime: 12000, attentionVariance: 0.18, uniqueIpCount: 1, sessionDuration: 240000 },
  { clickRate: 0.02, avgDwellTime: 6000, attentionVariance: 0.09, uniqueIpCount: 1, sessionDuration: 120000 },
  { clickRate: 0.04, avgDwellTime: 9000, attentionVariance: 0.15, uniqueIpCount: 2, sessionDuration: 300000 },
  { clickRate: 0.06, avgDwellTime: 11000, attentionVariance: 0.20, uniqueIpCount: 1, sessionDuration: 200000 },
  { clickRate: 0.03, avgDwellTime: 7500, attentionVariance: 0.11, uniqueIpCount: 1, sessionDuration: 150000 },
  { clickRate: 0.07, avgDwellTime: 13000, attentionVariance: 0.25, uniqueIpCount: 2, sessionDuration: 350000 },
  { clickRate: 0.02, avgDwellTime: 5000, attentionVariance: 0.08, uniqueIpCount: 1, sessionDuration: 100000 },
  { clickRate: 0.05, avgDwellTime: 10000, attentionVariance: 0.16, uniqueIpCount: 1, sessionDuration: 220000 },
  { clickRate: 0.04, avgDwellTime: 8000, attentionVariance: 0.13, uniqueIpCount: 1, sessionDuration: 190000 },
  // Suspicious / fraudulent patterns
  { clickRate: 0.9, avgDwellTime: 500, attentionVariance: 0.001, uniqueIpCount: 50, sessionDuration: 5000 },
  { clickRate: 0.85, avgDwellTime: 300, attentionVariance: 0.002, uniqueIpCount: 80, sessionDuration: 3000 },
  { clickRate: 1.0, avgDwellTime: 200, attentionVariance: 0.0, uniqueIpCount: 200, sessionDuration: 2000 },
  { clickRate: 0.95, avgDwellTime: 150, attentionVariance: 0.001, uniqueIpCount: 150, sessionDuration: 1500 },
  // More normal users for balance
  { clickRate: 0.03, avgDwellTime: 9500, attentionVariance: 0.14, uniqueIpCount: 1, sessionDuration: 210000 },
  { clickRate: 0.06, avgDwellTime: 11500, attentionVariance: 0.22, uniqueIpCount: 2, sessionDuration: 280000 },
  { clickRate: 0.04, avgDwellTime: 7800, attentionVariance: 0.10, uniqueIpCount: 1, sessionDuration: 170000 },
  { clickRate: 0.05, avgDwellTime: 14000, attentionVariance: 0.19, uniqueIpCount: 1, sessionDuration: 320000 },
  { clickRate: 0.02, avgDwellTime: 6500, attentionVariance: 0.07, uniqueIpCount: 1, sessionDuration: 140000 },
  { clickRate: 0.07, avgDwellTime: 10500, attentionVariance: 0.21, uniqueIpCount: 2, sessionDuration: 260000 }
];

fraudDetector.trainOnHistoricalData(SYNTHETIC_TRAINING_DATA);
