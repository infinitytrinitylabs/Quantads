import { randomInt } from "node:crypto";
import { IsolationFeatureVector, IsolationForestResult, IsolationTreeSnapshot } from "./types";
import { average, clamp, round, standardDeviation } from "./math";

interface IsolationSample {
  id: string;
  vector: IsolationFeatureVector;
  receivedAt: string;
}

interface IsolationLeafNode {
  kind: "leaf";
  depth: number;
  size: number;
  centroid: number[];
  variance: number[];
}

interface IsolationBranchNode {
  kind: "branch";
  depth: number;
  splitFeature: number;
  splitValue: number;
  left: IsolationNode;
  right: IsolationNode;
  minValue: number;
  maxValue: number;
}

type IsolationNode = IsolationLeafNode | IsolationBranchNode;

interface IsolationTree {
  treeIndex: number;
  root: IsolationNode;
  sampleSize: number;
  maxDepth: number;
  labels: string[];
}

export interface IsolationForestConfig {
  treeCount: number;
  subsampleSize: number;
  maxDepth: number;
  retrainInterval: number;
  warmupSamples: number;
  baselineSampleLimit: number;
}

const DEFAULT_CONFIG: IsolationForestConfig = {
  treeCount: 64,
  subsampleSize: 48,
  maxDepth: 12,
  retrainInterval: 12,
  warmupSamples: 24,
  baselineSampleLimit: 512
};

const EULER_MASCHERONI = 0.5772156649;

const harmonicNumber = (value: number): number => {
  if (value <= 0) {
    return 0;
  }

  return Math.log(value) + EULER_MASCHERONI;
};

const averagePathLength = (sampleSize: number): number => {
  if (sampleSize <= 1) {
    return 0;
  }

  if (sampleSize === 2) {
    return 1;
  }

  return 2 * harmonicNumber(sampleSize - 1) - (2 * (sampleSize - 1)) / sampleSize;
};

const centroid = (points: number[][]): number[] => {
  if (!points.length) {
    return [];
  }

  const width = points[0]?.length ?? 0;
  const result = Array.from({ length: width }, () => 0);

  for (const point of points) {
    for (let index = 0; index < width; index += 1) {
      result[index] += point[index] ?? 0;
    }
  }

  for (let index = 0; index < width; index += 1) {
    result[index] /= points.length;
  }

  return result;
};

const variance = (points: number[][], means: number[]): number[] => {
  if (!points.length) {
    return [];
  }

  const width = points[0]?.length ?? 0;
  const result = Array.from({ length: width }, () => 0);

  for (const point of points) {
    for (let index = 0; index < width; index += 1) {
      const delta = (point[index] ?? 0) - (means[index] ?? 0);
      result[index] += delta * delta;
    }
  }

  for (let index = 0; index < width; index += 1) {
    result[index] /= points.length;
  }

  return result;
};

const euclideanDistance = (left: number[], right: number[]): number => {
  const width = Math.max(left.length, right.length);
  let total = 0;

  for (let index = 0; index < width; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    total += delta * delta;
  }

  return Math.sqrt(total);
};

const sampleWithoutReplacement = <T>(values: T[], sampleSize: number): T[] => {
  if (values.length <= sampleSize) {
    return [...values];
  }

  const pool = [...values];
  const sample: T[] = [];

  while (sample.length < sampleSize && pool.length > 0) {
    const index = randomInt(0, pool.length);
    sample.push(pool.splice(index, 1)[0] as T);
  }

  return sample;
};

const chooseSplitFeature = (points: number[][]): { featureIndex: number; minValue: number; maxValue: number } | null => {
  if (!points.length) {
    return null;
  }

  const width = points[0]?.length ?? 0;
  const candidates: Array<{ featureIndex: number; minValue: number; maxValue: number; spread: number }> = [];

  for (let featureIndex = 0; featureIndex < width; featureIndex += 1) {
    const featureValues = points.map((point) => point[featureIndex] ?? 0);
    const minValue = Math.min(...featureValues);
    const maxValue = Math.max(...featureValues);
    const spread = maxValue - minValue;

    if (spread > 0) {
      candidates.push({ featureIndex, minValue, maxValue, spread });
    }
  }

  if (!candidates.length) {
    return null;
  }

  const weights = candidates.map((candidate) => candidate.spread);
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  let roll = Math.random() * totalWeight;

  for (const candidate of candidates) {
    roll -= candidate.spread;
    if (roll <= 0) {
      return candidate;
    }
  }

  return candidates[candidates.length - 1] ?? null;
};

const splitThreshold = (minimum: number, maximum: number): number => {
  if (maximum <= minimum) {
    return minimum;
  }

  return minimum + Math.random() * (maximum - minimum);
};

export class IsolationForest {
  private readonly config: IsolationForestConfig;
  private readonly samples: IsolationSample[] = [];
  private trees: IsolationTree[] = [];
  private sinceRetrain = 0;
  private featureLabels: string[] = [];

  constructor(config?: Partial<IsolationForestConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  ingest(sample: IsolationFeatureVector, id: string, receivedAt = new Date().toISOString()): void {
    this.featureLabels = sample.labels;
    this.samples.push({ id, vector: sample, receivedAt });

    if (this.samples.length > this.config.baselineSampleLimit) {
      this.samples.shift();
    }

    this.sinceRetrain += 1;
    if (this.shouldRetrain()) {
      this.fit();
    }
  }

  score(sample: IsolationFeatureVector): IsolationForestResult {
    this.featureLabels = sample.labels;

    if (!this.trees.length || this.samples.length < this.config.warmupSamples) {
      return this.scoreAgainstWarmup(sample);
    }

    const pathLengths: number[] = [];
    const treeSnapshots: IsolationTreeSnapshot[] = [];

    for (const tree of this.trees) {
      const traversal = this.pathLength(tree.root, sample.values, 0);
      pathLengths.push(traversal.pathLength);
      treeSnapshots.push({
        treeIndex: tree.treeIndex,
        depth: traversal.depth,
        mass: traversal.mass,
        normalizedDepth: round(clamp(traversal.pathLength / Math.max(tree.maxDepth, 1), 0, 2), 6)
      });
    }

    const meanPathLength = average(pathLengths);
    const baseline = averagePathLength(this.config.subsampleSize);
    const rawScore = baseline > 0 ? 2 ** (-meanPathLength / baseline) : 0;
    const normalizedScore = round(clamp(rawScore, 0, 1), 6);
    const suspected = normalizedScore >= 0.64;

    return {
      score: normalizedScore,
      normalizedScore,
      suspected,
      reason: suspected
        ? "Isolation Forest marked the traffic pattern as statistically rare"
        : "Isolation Forest found the traffic pattern consistent with historical norms",
      sampleSize: this.samples.length,
      featureVector: sample,
      treeSnapshots
    };
  }

  fit(): void {
    if (this.samples.length < this.config.warmupSamples) {
      return;
    }

    const trees: IsolationTree[] = [];

    for (let treeIndex = 0; treeIndex < this.config.treeCount; treeIndex += 1) {
      const sampled = sampleWithoutReplacement(this.samples, this.config.subsampleSize);
      const points = sampled.map((entry) => entry.vector.values);
      const root = this.buildTree(points, 0, this.config.maxDepth);
      trees.push({
        treeIndex,
        root,
        sampleSize: sampled.length,
        maxDepth: this.config.maxDepth,
        labels: this.featureLabels
      });
    }

    this.trees = trees;
    this.sinceRetrain = 0;
  }

  snapshot(): { sampleSize: number; treeCount: number; featureLabels: string[] } {
    return {
      sampleSize: this.samples.length,
      treeCount: this.trees.length,
      featureLabels: [...this.featureLabels]
    };
  }

  private shouldRetrain(): boolean {
    if (this.samples.length < this.config.warmupSamples) {
      return false;
    }

    if (!this.trees.length) {
      return true;
    }

    return this.sinceRetrain >= this.config.retrainInterval;
  }

  private scoreAgainstWarmup(sample: IsolationFeatureVector): IsolationForestResult {
    const historical = this.samples.map((entry) => entry.vector.values);
    const sampleSize = historical.length;

    if (!historical.length) {
      return {
        score: 0,
        normalizedScore: 0,
        suspected: false,
        reason: "Isolation Forest is still warming up and has no baseline samples yet",
        sampleSize,
        featureVector: sample,
        treeSnapshots: []
      };
    }

    const center = centroid(historical);
    const spreads = variance(historical, center).map((value) => Math.sqrt(value));
    const distance = euclideanDistance(sample.values, center);
    const expectedDistance = average(spreads) * Math.sqrt(sample.values.length || 1);
    const normalizedScore = round(clamp(expectedDistance > 0 ? distance / (expectedDistance * 3) : 0, 0, 1), 6);
    const suspected = normalizedScore >= 0.72;

    return {
      score: normalizedScore,
      normalizedScore,
      suspected,
      reason: suspected
        ? "Warmup scoring flagged the request as materially different from the current baseline"
        : "Warmup scoring considers the request close to the current traffic baseline",
      sampleSize,
      featureVector: sample,
      treeSnapshots: []
    };
  }

  private buildTree(points: number[][], depth: number, maxDepth: number): IsolationNode {
    if (depth >= maxDepth || points.length <= 1) {
      return this.makeLeaf(points, depth);
    }

    const split = chooseSplitFeature(points);

    if (!split) {
      return this.makeLeaf(points, depth);
    }

    const threshold = splitThreshold(split.minValue, split.maxValue);
    const left = points.filter((point) => (point[split.featureIndex] ?? 0) < threshold);
    const right = points.filter((point) => (point[split.featureIndex] ?? 0) >= threshold);

    if (!left.length || !right.length) {
      return this.makeLeaf(points, depth);
    }

    return {
      kind: "branch",
      depth,
      splitFeature: split.featureIndex,
      splitValue: threshold,
      left: this.buildTree(left, depth + 1, maxDepth),
      right: this.buildTree(right, depth + 1, maxDepth),
      minValue: split.minValue,
      maxValue: split.maxValue
    };
  }

  private makeLeaf(points: number[][], depth: number): IsolationLeafNode {
    const center = centroid(points);
    return {
      kind: "leaf",
      depth,
      size: points.length,
      centroid: center,
      variance: variance(points, center)
    };
  }

  private pathLength(node: IsolationNode, values: number[], traversedDepth: number): {
    pathLength: number;
    depth: number;
    mass: number;
  } {
    if (node.kind === "leaf") {
      const adjustedDepth = traversedDepth + averagePathLength(node.size);
      const varianceMagnitude = Math.sqrt(node.variance.reduce((total, value) => total + value, 0));
      const mass = round(clamp(1 / (1 + varianceMagnitude + node.size / 10), 0, 1), 6);
      return {
        pathLength: adjustedDepth,
        depth: node.depth,
        mass
      };
    }

    const featureValue = values[node.splitFeature] ?? 0;
    if (featureValue < node.splitValue) {
      return this.pathLength(node.left, values, traversedDepth + 1);
    }

    return this.pathLength(node.right, values, traversedDepth + 1);
  }

  describeFeatureDrift(): Array<{ label: string; mean: number; standardDeviation: number }> {
    if (!this.samples.length || !this.featureLabels.length) {
      return [];
    }

    return this.featureLabels.map((label, index) => {
      const values = this.samples.map((sample) => sample.vector.values[index] ?? 0);
      return {
        label,
        mean: round(average(values), 6),
        standardDeviation: round(standardDeviation(values), 6)
      };
    });
  }
}
