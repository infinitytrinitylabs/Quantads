/**
 * AttentionHeatmapService
 *
 * Aggregates gaze / attention samples into a spatial density grid for
 * campaign creatives.
 *
 * Privacy-preserving design:
 *   - Per-user samples are never returned; only aggregated grids.
 *   - A grid cell is only exposed when it has contributions from at
 *     least `K_ANONYMITY_MIN_USERS` distinct users (k-anonymity).
 *   - Samples are retained at a fixed grid resolution so per-pixel
 *     fingerprinting is impossible.
 *   - Raw user IDs are only tracked in a short-lived Set used to count
 *     unique users per cell; they never leave the service.
 */

export interface HeatmapSample {
  campaignId: string;
  creativeId: string;
  userId: string;
  /** Normalized coordinates in [0,1] × [0,1]. */
  x: number;
  y: number;
  /** Weight (e.g., dwell time in ms, clipped to [0, 10_000]). */
  weightMs: number;
  /** Optional timestamp — currently only used for retention pruning. */
  occurredAt?: string;
}

export interface HeatmapCell {
  x: number; // grid cell x-index
  y: number; // grid cell y-index
  weight: number;
  uniqueUsers: number;
}

export interface HeatmapGrid {
  campaignId: string;
  creativeId: string;
  resolution: number;
  cells: HeatmapCell[];
  totalSamples: number;
  distinctUsers: number;
  kAnonymityThreshold: number;
  generatedAt: string;
}

const GRID_RESOLUTION = 32; // 32x32 bins ⇒ ~3% spatial granularity
const K_ANONYMITY_MIN_USERS = 5;
const MAX_WEIGHT_MS = 10_000;
const MAX_SAMPLES_PER_CREATIVE = 50_000;

interface CreativeBucket {
  samples: number;
  distinctUsers: Set<string>;
  cells: Map<string, { weight: number; users: Set<string> }>;
}

export class AttentionHeatmapService {
  private readonly buckets = new Map<string, CreativeBucket>();
  private readonly kThreshold: number;

  constructor(options: { kThreshold?: number } = {}) {
    this.kThreshold = options.kThreshold ?? K_ANONYMITY_MIN_USERS;
  }

  ingest(sample: HeatmapSample): void {
    if (sample.x < 0 || sample.x > 1 || sample.y < 0 || sample.y > 1) {
      throw new Error("sample coordinates must be normalized to [0,1]");
    }
    if (!Number.isFinite(sample.weightMs) || sample.weightMs < 0) {
      throw new Error("weightMs must be a finite non-negative number");
    }

    const key = bucketKey(sample.campaignId, sample.creativeId);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { samples: 0, distinctUsers: new Set(), cells: new Map() };
      this.buckets.set(key, bucket);
    }

    if (bucket.samples >= MAX_SAMPLES_PER_CREATIVE) {
      return; // hard ceiling; operators should roll forward snapshots
    }

    const clampedWeight = Math.min(sample.weightMs, MAX_WEIGHT_MS);
    const cx = Math.min(GRID_RESOLUTION - 1, Math.floor(sample.x * GRID_RESOLUTION));
    const cy = Math.min(GRID_RESOLUTION - 1, Math.floor(sample.y * GRID_RESOLUTION));
    const cellKey = `${cx}:${cy}`;

    let cell = bucket.cells.get(cellKey);
    if (!cell) {
      cell = { weight: 0, users: new Set() };
      bucket.cells.set(cellKey, cell);
    }
    cell.weight += clampedWeight;
    cell.users.add(sample.userId);
    bucket.distinctUsers.add(sample.userId);
    bucket.samples += 1;
  }

  /**
   * Return a heatmap grid only when the creative has enough overall
   * distinct users and only with cells that pass the k-anonymity gate.
   */
  getGrid(campaignId: string, creativeId: string): HeatmapGrid | null {
    const key = bucketKey(campaignId, creativeId);
    const bucket = this.buckets.get(key);
    if (!bucket) return null;

    if (bucket.distinctUsers.size < this.kThreshold) {
      return {
        campaignId,
        creativeId,
        resolution: GRID_RESOLUTION,
        cells: [],
        totalSamples: bucket.samples,
        distinctUsers: bucket.distinctUsers.size,
        kAnonymityThreshold: this.kThreshold,
        generatedAt: new Date().toISOString()
      };
    }

    const cells: HeatmapCell[] = [];
    for (const [cellKey, cell] of bucket.cells) {
      if (cell.users.size < this.kThreshold) continue;
      const [xs, ys] = cellKey.split(":");
      cells.push({
        x: Number(xs),
        y: Number(ys),
        weight: Number(cell.weight.toFixed(2)),
        uniqueUsers: cell.users.size
      });
    }

    cells.sort((a, b) => b.weight - a.weight);

    return {
      campaignId,
      creativeId,
      resolution: GRID_RESOLUTION,
      cells,
      totalSamples: bucket.samples,
      distinctUsers: bucket.distinctUsers.size,
      kAnonymityThreshold: this.kThreshold,
      generatedAt: new Date().toISOString()
    };
  }

  /** For tests / ops: drop a bucket's data. */
  clear(campaignId: string, creativeId: string): void {
    this.buckets.delete(bucketKey(campaignId, creativeId));
  }
}

function bucketKey(campaignId: string, creativeId: string): string {
  return `${campaignId}::${creativeId}`;
}

export const attentionHeatmapService = new AttentionHeatmapService();
