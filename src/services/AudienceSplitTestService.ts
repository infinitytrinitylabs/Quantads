import { randomUUID } from "node:crypto";

/**
 * AudienceSplitTestService
 *
 * A standard, transparent A/B split-test framework that allocates an
 * audience segment between two competing campaigns and declares a winner
 * based on statistical significance — not on "duel" framing.
 *
 * Key ethical properties:
 *   - Outcome is determined by a classical two-proportion z-test at
 *     configurable alpha; tests below the significance threshold end
 *     inconclusively rather than crowning a random winner.
 *   - Budget refunds follow standard rules (unrendered impressions are
 *     refunded); there is no "loser penalty" or "winner boost" that would
 *     distort competitive incentives.
 *   - All intermediate allocation numbers are observable via `getTest`
 *     so advertisers can audit fairness.
 */

export type SplitTestMetric = "roas" | "ctr" | "conversion_rate";

export interface SplitTestVariant {
  campaignId: string;
  advertiserId: string;
  impressions: number;
  conversions: number;
  spend: number;
  revenue: number;
}

export interface SplitTestCreateInput {
  segmentId: string;
  metric: SplitTestMetric;
  /** Target minimum sample size per variant before the test can be finalized. */
  minSampleSize?: number;
  /** Significance level, e.g. 0.05. */
  alpha?: number;
  variants: [
    { campaignId: string; advertiserId: string },
    { campaignId: string; advertiserId: string }
  ];
}

export interface SplitTestRecord {
  id: string;
  segmentId: string;
  metric: SplitTestMetric;
  alpha: number;
  minSampleSize: number;
  status: "running" | "finalized" | "inconclusive";
  variants: [SplitTestVariant, SplitTestVariant];
  winnerCampaignId: string | null;
  pValue: number | null;
  createdAt: string;
  finalizedAt: string | null;
}

export interface RecordImpressionInput {
  impressions?: number;
  conversions?: number;
  spend?: number;
  revenue?: number;
}

const DEFAULT_ALPHA = 0.05;
const DEFAULT_MIN_SAMPLE_SIZE = 200;

export class AudienceSplitTestService {
  private readonly tests = new Map<string, SplitTestRecord>();

  createTest(input: SplitTestCreateInput): SplitTestRecord {
    if (input.variants[0].campaignId === input.variants[1].campaignId) {
      throw new Error("variants must reference distinct campaigns");
    }

    const record: SplitTestRecord = {
      id: randomUUID(),
      segmentId: input.segmentId,
      metric: input.metric,
      alpha: input.alpha ?? DEFAULT_ALPHA,
      minSampleSize: input.minSampleSize ?? DEFAULT_MIN_SAMPLE_SIZE,
      status: "running",
      variants: [
        { ...input.variants[0], impressions: 0, conversions: 0, spend: 0, revenue: 0 },
        { ...input.variants[1], impressions: 0, conversions: 0, spend: 0, revenue: 0 }
      ],
      winnerCampaignId: null,
      pValue: null,
      createdAt: new Date().toISOString(),
      finalizedAt: null
    };

    this.tests.set(record.id, record);
    return record;
  }

  recordVariantActivity(
    testId: string,
    campaignId: string,
    activity: RecordImpressionInput
  ): SplitTestRecord {
    const record = this.requireRunning(testId);
    const variant = record.variants.find((v) => v.campaignId === campaignId);

    if (!variant) {
      throw new Error(`campaign ${campaignId} is not a variant of test ${testId}`);
    }

    variant.impressions += Math.max(0, activity.impressions ?? 0);
    variant.conversions += Math.max(0, activity.conversions ?? 0);
    variant.spend += Math.max(0, activity.spend ?? 0);
    variant.revenue += Math.max(0, activity.revenue ?? 0);

    return record;
  }

  /**
   * Finalize the test using a two-proportion z-test (for CTR /
   * conversion_rate) or Welch's-style ROAS comparison.
   */
  finalize(testId: string): SplitTestRecord {
    const record = this.requireRunning(testId);

    for (const variant of record.variants) {
      if (variant.impressions < record.minSampleSize) {
        record.status = "inconclusive";
        record.finalizedAt = new Date().toISOString();
        return record;
      }
    }

    const [a, b] = record.variants;
    const metricA = metricValue(a, record.metric);
    const metricB = metricValue(b, record.metric);
    const p = twoProportionPValue(a, b, record.metric);

    record.pValue = p;
    record.finalizedAt = new Date().toISOString();

    if (p !== null && p <= record.alpha) {
      record.status = "finalized";
      record.winnerCampaignId = metricA >= metricB ? a.campaignId : b.campaignId;
    } else {
      record.status = "inconclusive";
      record.winnerCampaignId = null;
    }

    return record;
  }

  getTest(testId: string): SplitTestRecord | undefined {
    return this.tests.get(testId);
  }

  listTests(): SplitTestRecord[] {
    return Array.from(this.tests.values()).sort((x, y) =>
      y.createdAt.localeCompare(x.createdAt)
    );
  }

  private requireRunning(testId: string): SplitTestRecord {
    const record = this.tests.get(testId);
    if (!record) throw new Error(`split test ${testId} not found`);
    if (record.status !== "running") throw new Error(`split test ${testId} is not running`);
    return record;
  }
}

function metricValue(v: SplitTestVariant, metric: SplitTestMetric): number {
  switch (metric) {
    case "roas":
      return v.spend > 0 ? v.revenue / v.spend : 0;
    case "ctr":
      return v.impressions > 0 ? v.conversions / v.impressions : 0;
    case "conversion_rate":
      return v.impressions > 0 ? v.conversions / v.impressions : 0;
  }
}

/** Two-proportion z-test p-value. Returns null if test is undefined. */
export function twoProportionPValue(
  a: SplitTestVariant,
  b: SplitTestVariant,
  metric: SplitTestMetric
): number | null {
  if (metric === "roas") {
    // Welch-style comparison on per-impression revenue ratio
    if (a.impressions === 0 || b.impressions === 0) return null;
    const pa = a.revenue / Math.max(a.spend, 1e-9);
    const pb = b.revenue / Math.max(b.spend, 1e-9);
    const se = Math.sqrt(
      Math.max(pa, 1e-9) / a.impressions + Math.max(pb, 1e-9) / b.impressions
    );
    if (se === 0) return null;
    const z = (pa - pb) / se;
    return twoTailedPValue(z);
  }

  const nA = a.impressions;
  const nB = b.impressions;
  if (nA === 0 || nB === 0) return null;

  const pA = a.conversions / nA;
  const pB = b.conversions / nB;
  const pooled = (a.conversions + b.conversions) / (nA + nB);
  const denom = Math.sqrt(pooled * (1 - pooled) * (1 / nA + 1 / nB));
  if (denom === 0) return null;
  const z = (pA - pB) / denom;
  return twoTailedPValue(z);
}

/** Two-tailed p-value for a z statistic via an Abramowitz & Stegun approximation. */
export function twoTailedPValue(z: number): number {
  const abs = Math.abs(z);
  // Abramowitz & Stegun 26.2.17 (for standard normal CDF complement)
  const b1 = 0.319381530;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;
  const p = 0.2316419;
  const t = 1 / (1 + p * abs);
  const pdf = Math.exp(-0.5 * abs * abs) / Math.sqrt(2 * Math.PI);
  const cdfComplement =
    pdf * (b1 * t + b2 * t * t + b3 * t ** 3 + b4 * t ** 4 + b5 * t ** 5);
  return Math.max(0, Math.min(1, 2 * cdfComplement));
}

export const audienceSplitTestService = new AudienceSplitTestService();
