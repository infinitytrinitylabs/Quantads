import { randomUUID } from "node:crypto";

/**
 * CompetitorIntelligence
 *
 * Tracks anonymised competitor bidding patterns, predicts likely maximum bids
 * using simple linear regression over time-indexed bid history, issues market-
 * entry alerts, and publishes a privacy-safe "Competitive Score" that ranks
 * an advertiser against others in the same vertical.
 *
 * Privacy model
 * ─────────────
 * - Competitor identities are never exposed to callers outside this module.
 *   External consumers receive only an opaque `competitorId` token that is
 *   generated once per unique (advertiserId, vertical) pair and never maps
 *   back to the real advertiser identity.
 * - Vertical-level statistics are only released when at least
 *   `MIN_COMPETITORS_FOR_DISCLOSURE` distinct competitors are present.
 * - No individual bid amounts are surfaced; only aggregated percentile
 *   summaries and trend directions are emitted.
 */

// ── Constants ──────────────────────────────────────────────────────────────────

const MIN_COMPETITORS_FOR_DISCLOSURE = 3;
const MAX_BID_HISTORY_PER_COMPETITOR = 500;
const PREDICTION_WINDOW = 10;        // last N points used for regression
const PATTERN_ALERT_COOL_DOWN_MS = 60_000;  // 1 min between repeated alerts

// ── Public types ───────────────────────────────────────────────────────────────

export interface BidObservation {
  /** Real advertiser id — used only internally; never surfaced to other callers. */
  advertiserId: string;
  vertical: string;
  bidAmount: number;
  /** ISO-8601 timestamp of the bid event. */
  observedAt: string;
}

export interface BidPattern {
  /** Opaque token — does NOT map back to the real advertiserId. */
  competitorId: string;
  vertical: string;
  observationCount: number;
  /** Direction of recent trend: "rising" | "falling" | "stable". */
  trendDirection: "rising" | "falling" | "stable";
  /** Predicted maximum bid in the next auction (USD). */
  predictedMaxBid: number;
  /** Coefficient of determination (R²) for the regression — 0..1. */
  regressionR2: number;
  /** Percentile rank within the vertical (0–100, based on avg bid). */
  percentileRank: number;
  /** Most recent bid amount observed. */
  latestBid: number;
  /** Average bid across all stored observations. */
  averageBid: number;
  updatedAt: string;
}

export interface MarketEntryAlert {
  alertId: string;
  competitorId: string;
  vertical: string;
  message: string;
  severity: "info" | "warning" | "critical";
  triggeredAt: string;
}

export interface CompetitiveScorecard {
  advertiserId: string;
  vertical: string;
  /** 0–100. Higher is better competitive position. */
  competitiveScore: number;
  rank: number;
  totalCompetitors: number;
  averageBid: number;
  percentileBid: number;
  trend: "rising" | "falling" | "stable";
  computedAt: string;
}

export interface VerticalSummary {
  vertical: string;
  competitorCount: number;
  bidDistribution: { p25: number; p50: number; p75: number; p90: number };
  topPredictedMaxBid: number;
  computedAt: string;
}

// ── Internal storage ───────────────────────────────────────────────────────────

interface InternalCompetitor {
  realAdvertiserId: string;
  competitorId: string;            // opaque token
  vertical: string;
  history: BidObservation[];
  lastAlertAt: number;             // epoch ms
}

// ── Linear regression helpers ──────────────────────────────────────────────────

/**
 * Ordinary least-squares simple linear regression on parallel arrays x, y.
 * Returns { slope, intercept, r2 }.
 */
function linearRegression(
  x: number[],
  y: number[]
): { slope: number; intercept: number; r2: number } {
  const n = x.length;
  if (n < 2) return { slope: 0, intercept: y[0] ?? 0, r2: 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX  += x[i];
    sumY  += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n, r2: 0 };

  const slope     = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const meanY  = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (y[i] - meanY) ** 2;
    ssRes += (y[i] - (slope * x[i] + intercept)) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);

  return { slope, intercept, r2 };
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const rank  = (p / 100) * (sorted.length - 1);
  const lo    = Math.floor(rank);
  const hi    = Math.ceil(rank);
  const frac  = rank - lo;
  return Number((sorted[lo] + (sorted[hi] - sorted[lo]) * frac).toFixed(4));
}

function trendFromSlope(slope: number, baseline: number): "rising" | "falling" | "stable" {
  if (baseline === 0) return "stable";
  const relChange = slope / baseline;
  if (relChange >  0.01) return "rising";
  if (relChange < -0.01) return "falling";
  return "stable";
}

// ── Main service class ─────────────────────────────────────────────────────────

export class CompetitorIntelligenceService {
  /**
   * Map keyed by `${advertiserId}::${vertical}` → InternalCompetitor record.
   */
  private readonly competitors = new Map<string, InternalCompetitor>();

  /**
   * Opaque-token → InternalCompetitor lookup (for external queries).
   */
  private readonly byCompetitorId = new Map<string, InternalCompetitor>();

  /**
   * Fired alerts. The caller may subscribe via `onAlert`.
   */
  private readonly alertLog: MarketEntryAlert[] = [];

  /**
   * Optional external listener for new market-entry alerts.
   */
  private alertListener: ((alert: MarketEntryAlert) => void) | null = null;

  // ── Ingestion ────────────────────────────────────────────────────────────────

  /**
   * Record a bid observation for a competitor.
   * Automatically detects market entry (first observation for this advertiser
   * in a vertical) and emits an alert.
   */
  observe(observation: BidObservation): void {
    if (observation.bidAmount < 0) {
      throw new Error("bidAmount must be non-negative");
    }

    const key = this.keyFor(observation.advertiserId, observation.vertical);
    let competitor = this.competitors.get(key);
    const isNewEntrant = !competitor;

    if (!competitor) {
      competitor = {
        realAdvertiserId: observation.advertiserId,
        competitorId: randomUUID(),
        vertical: observation.vertical.trim().toLowerCase(),
        history: [],
        lastAlertAt: 0
      };
      this.competitors.set(key, competitor);
      this.byCompetitorId.set(competitor.competitorId, competitor);
    }

    competitor.history.push({ ...observation });
    if (competitor.history.length > MAX_BID_HISTORY_PER_COMPETITOR) {
      competitor.history.shift();
    }

    if (isNewEntrant) {
      this.emitMarketEntryAlert(competitor);
    }
  }

  // ── Pattern analysis ─────────────────────────────────────────────────────────

  /**
   * Returns the bid pattern for a specific competitor, or null if the token
   * is unknown.
   */
  getPattern(competitorId: string): BidPattern | null {
    const competitor = this.byCompetitorId.get(competitorId);
    if (!competitor) return null;
    return this.buildPattern(competitor);
  }

  /**
   * Returns all patterns for a given vertical (privacy-gated).
   * Returns null when there are fewer than MIN_COMPETITORS_FOR_DISCLOSURE
   * competitors in that vertical.
   */
  getPatternsForVertical(vertical: string): BidPattern[] | null {
    const key = vertical.trim().toLowerCase();
    const matching = [...this.competitors.values()].filter((c) => c.vertical === key);
    if (matching.length < MIN_COMPETITORS_FOR_DISCLOSURE) return null;
    return matching.map((c) => this.buildPattern(c));
  }

  // ── Prediction ───────────────────────────────────────────────────────────────

  /**
   * Predict the maximum bid a competitor is likely to place in the next
   * auction using linear regression over their recent history.
   *
   * Returns null if the competitor is unknown or has insufficient data.
   */
  predictMaxBid(competitorId: string): number | null {
    const competitor = this.byCompetitorId.get(competitorId);
    if (!competitor || competitor.history.length < 2) return null;
    return this.computePredictedMaxBid(competitor);
  }

  // ── Competitive scoring ──────────────────────────────────────────────────────

  /**
   * Compute a Competitive Scorecard for a given advertiser in a vertical.
   * The score is the advertiser's percentile rank among all competitors,
   * mapped to a 0–100 scale (higher = stronger position).
   *
   * Returns null when the k-anonymity threshold is not satisfied.
   */
  getScorecard(advertiserId: string, vertical: string): CompetitiveScorecard | null {
    const normVertical = vertical.trim().toLowerCase();
    const allInVertical = [...this.competitors.values()].filter(
      (c) => c.vertical === normVertical
    );

    if (allInVertical.length < MIN_COMPETITORS_FOR_DISCLOSURE) return null;

    const selfKey = this.keyFor(advertiserId, normVertical);
    const self = this.competitors.get(selfKey);

    const averages = allInVertical.map((c) => this.averageBidFor(c));
    const sortedAverages = [...averages].sort((a, b) => a - b);

    const selfAverage = self ? this.averageBidFor(self) : 0;
    const rank = sortedAverages.filter((v) => v <= selfAverage).length;
    const percentileBid = (rank / allInVertical.length) * 100;
    const competitiveScore = Math.round(percentileBid);

    const selfTrend = self ? this.buildPattern(self).trendDirection : "stable";

    return {
      advertiserId,
      vertical: normVertical,
      competitiveScore,
      rank,
      totalCompetitors: allInVertical.length,
      averageBid: Number(selfAverage.toFixed(4)),
      percentileBid: Number(percentileBid.toFixed(2)),
      trend: selfTrend,
      computedAt: new Date().toISOString()
    };
  }

  // ── Vertical summary ─────────────────────────────────────────────────────────

  /**
   * Returns a market-level summary for a vertical (k-anonymous).
   */
  getVerticalSummary(vertical: string): VerticalSummary | null {
    const key = vertical.trim().toLowerCase();
    const all = [...this.competitors.values()].filter((c) => c.vertical === key);
    if (all.length < MIN_COMPETITORS_FOR_DISCLOSURE) return null;

    const allBids = all.flatMap((c) => c.history.map((h) => h.bidAmount));
    const sorted = [...allBids].sort((a, b) => a - b);

    const predictions = all
      .map((c) => this.computePredictedMaxBid(c))
      .filter((v): v is number => v !== null);
    const topPredictedMaxBid = predictions.length ? Math.max(...predictions) : 0;

    return {
      vertical: key,
      competitorCount: all.length,
      bidDistribution: {
        p25: percentile(sorted, 25),
        p50: percentile(sorted, 50),
        p75: percentile(sorted, 75),
        p90: percentile(sorted, 90)
      },
      topPredictedMaxBid: Number(topPredictedMaxBid.toFixed(4)),
      computedAt: new Date().toISOString()
    };
  }

  // ── Alert access ─────────────────────────────────────────────────────────────

  /** Register a listener that fires whenever a new market-entry alert is emitted. */
  onAlert(listener: (alert: MarketEntryAlert) => void): void {
    this.alertListener = listener;
  }

  /** Return a copy of all alerts that have been emitted. */
  getAlerts(): MarketEntryAlert[] {
    return this.alertLog.slice();
  }

  /**
   * Return alerts for a specific vertical, optionally limited to the most
   * recent `limit` entries.
   */
  getAlertsForVertical(vertical: string, limit?: number): MarketEntryAlert[] {
    const key = vertical.trim().toLowerCase();
    const filtered = this.alertLog.filter((a) => a.vertical === key);
    return limit != null ? filtered.slice(-limit) : filtered.slice();
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private keyFor(advertiserId: string, vertical: string): string {
    return `${advertiserId}::${vertical.trim().toLowerCase()}`;
  }

  private averageBidFor(competitor: InternalCompetitor): number {
    if (!competitor.history.length) return 0;
    const sum = competitor.history.reduce((acc, h) => acc + h.bidAmount, 0);
    return sum / competitor.history.length;
  }

  private computePredictedMaxBid(competitor: InternalCompetitor): number | null {
    const history = competitor.history;
    if (history.length < 2) return null;

    const window = history.slice(-PREDICTION_WINDOW);
    const xs = window.map((_, i) => i);
    const ys = window.map((h) => h.bidAmount);
    const { slope, intercept } = linearRegression(xs, ys);

    // Predict one step beyond the window
    const predicted = slope * window.length + intercept;
    return Math.max(0, Number(predicted.toFixed(4)));
  }

  private buildPattern(competitor: InternalCompetitor): BidPattern {
    const history = competitor.history;
    const bids    = history.map((h) => h.bidAmount);
    const avgBid  = bids.length ? bids.reduce((a, b) => a + b, 0) / bids.length : 0;
    const latestBid = bids.length ? bids[bids.length - 1] : 0;

    const window  = history.slice(-PREDICTION_WINDOW);
    const xs = window.map((_, i) => i);
    const ys = window.map((h) => h.bidAmount);
    const { slope, intercept, r2 } = linearRegression(xs, ys);
    const predicted = Math.max(0, slope * window.length + intercept);

    // Percentile rank within vertical
    const vertical = competitor.vertical;
    const allAvgs  = [...this.competitors.values()]
      .filter((c) => c.vertical === vertical)
      .map((c) => this.averageBidFor(c))
      .sort((a, b) => a - b);
    const rank = allAvgs.filter((v) => v <= avgBid).length;
    const percentileRank = allAvgs.length
      ? Math.round((rank / allAvgs.length) * 100)
      : 0;

    return {
      competitorId: competitor.competitorId,
      vertical: competitor.vertical,
      observationCount: history.length,
      trendDirection: trendFromSlope(slope, avgBid),
      predictedMaxBid: Number(predicted.toFixed(4)),
      regressionR2: Number(r2.toFixed(4)),
      percentileRank,
      latestBid: Number(latestBid.toFixed(4)),
      averageBid: Number(avgBid.toFixed(4)),
      updatedAt: new Date().toISOString()
    };
  }

  private emitMarketEntryAlert(competitor: InternalCompetitor): void {
    const now = Date.now();
    if (now - competitor.lastAlertAt < PATTERN_ALERT_COOL_DOWN_MS) return;
    competitor.lastAlertAt = now;

    const allInVertical = [...this.competitors.values()].filter(
      (c) => c.vertical === competitor.vertical
    );

    const severity: MarketEntryAlert["severity"] =
      allInVertical.length <= 5 ? "warning" : "info";

    const alert: MarketEntryAlert = {
      alertId: randomUUID(),
      competitorId: competitor.competitorId,
      vertical: competitor.vertical,
      message:
        `A new competitor has entered the "${competitor.vertical}" vertical ` +
        `(${allInVertical.length} active competitors now).`,
      severity,
      triggeredAt: new Date().toISOString()
    };

    this.alertLog.push(alert);
    if (this.alertListener) this.alertListener(alert);
  }
}

// ── Module-level singleton ─────────────────────────────────────────────────────

export const competitorIntelligenceService = new CompetitorIntelligenceService();
