/**
 * CompetitorMarketIntelService
 *
 * Aggregated, pull-based market intelligence for advertisers.
 *
 * Ethical design:
 *   - Data is only ever exposed in aggregate with k-anonymity
 *     (`MIN_COMPETITORS_FOR_DISCLOSURE` distinct advertisers per
 *     category). If the threshold is not met the response simply
 *     omits the category instead of "pushing" misleading signals.
 *   - There is no proactive alerting / notification channel — advertisers
 *     must explicitly query. This deliberately removes any
 *     "FOMO-pushing" surface.
 *   - Numeric values are exposed as distribution percentiles, not
 *     specific competitor figures.
 */

export interface CompetitorSpendSample {
  advertiserId: string;
  category: string;
  /** Daily budget in USD. */
  dailyBudget: number;
  /** Most recent CPM (optional, USD). */
  cpm?: number;
  /** Date the sample was recorded (YYYY-MM-DD). */
  date: string;
}

export interface CategoryMarketSnapshot {
  category: string;
  competitorCount: number;
  dailyBudget: { p25: number; p50: number; p75: number; p90: number };
  cpm: { p25: number; p50: number; p75: number; p90: number } | null;
  recordedOn: string;
  sampleSize: number;
}

const MIN_COMPETITORS_FOR_DISCLOSURE = 3;
const MAX_SAMPLES_PER_CATEGORY = 5000;

export class CompetitorMarketIntelService {
  private readonly samplesByCategory = new Map<string, CompetitorSpendSample[]>();

  ingest(sample: CompetitorSpendSample): void {
    if (sample.dailyBudget < 0) {
      throw new Error("dailyBudget must be non-negative");
    }

    const key = normalizeCategory(sample.category);
    let list = this.samplesByCategory.get(key);
    if (!list) {
      list = [];
      this.samplesByCategory.set(key, list);
    }

    list.push({ ...sample, category: key });
    if (list.length > MAX_SAMPLES_PER_CATEGORY) {
      list.shift();
    }
  }

  /**
   * Returns a market snapshot for a category, or null if the k-anonymity
   * threshold is not satisfied. `requestingAdvertiserId` is excluded so
   * advertisers don't get inflated signal from their own data.
   */
  getSnapshot(
    category: string,
    requestingAdvertiserId?: string
  ): CategoryMarketSnapshot | null {
    const key = normalizeCategory(category);
    const list = this.samplesByCategory.get(key) ?? [];

    const filtered = requestingAdvertiserId
      ? list.filter((s) => s.advertiserId !== requestingAdvertiserId)
      : list;

    const distinctAdvertisers = new Set(filtered.map((s) => s.advertiserId));
    if (distinctAdvertisers.size < MIN_COMPETITORS_FOR_DISCLOSURE) {
      return null;
    }

    const dailyBudgets = filtered.map((s) => s.dailyBudget).filter((v) => v >= 0);
    const cpms = filtered
      .map((s) => s.cpm)
      .filter((v): v is number => typeof v === "number" && v >= 0);

    return {
      category: key,
      competitorCount: distinctAdvertisers.size,
      dailyBudget: {
        p25: percentile(dailyBudgets, 25),
        p50: percentile(dailyBudgets, 50),
        p75: percentile(dailyBudgets, 75),
        p90: percentile(dailyBudgets, 90)
      },
      cpm: cpms.length
        ? {
            p25: percentile(cpms, 25),
            p50: percentile(cpms, 50),
            p75: percentile(cpms, 75),
            p90: percentile(cpms, 90)
          }
        : null,
      recordedOn: new Date().toISOString(),
      sampleSize: filtered.length
    };
  }
}

function normalizeCategory(category: string): string {
  return category.trim().toLowerCase();
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const interp = rank - lo;
  const result = sorted[lo] + (sorted[hi] - sorted[lo]) * interp;
  return Number(result.toFixed(2));
}

export const competitorMarketIntelService = new CompetitorMarketIntelService();
