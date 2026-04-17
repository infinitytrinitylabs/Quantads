/**
 * TrackingService – impression and click recording with deduplication.
 *
 * Rules enforced:
 *  - Impressions are buffered in memory and flushed to the store every 5 s.
 *  - Clicks are written immediately.
 *  - A click is only valid if a matching impression exists and was recorded
 *    within the last 30 seconds.
 *  - Same userId + adId cannot generate more than one valid click per 60 s
 *    (deduplication window).
 */

import { randomUUID } from "node:crypto";
import { Impression, Click } from "../types";

// ── Constants ─────────────────────────────────────────────────────────────────

const FLUSH_INTERVAL_MS    = 5_000;   // batch flush period
const CLICK_WINDOW_MS      = 30_000;  // click must arrive within 30 s of impression
const DEDUP_WINDOW_MS      = 60_000;  // one click per user+ad per 60 s

// ── In-memory stores ──────────────────────────────────────────────────────────

/** Finalized impressions (post-flush). */
const impressionStore = new Map<string, Impression>();

/** Finalized clicks. */
const clickStore = new Map<string, Click>();

/** Pending impressions waiting to be flushed. */
let pendingImpressions: Impression[] = [];

/**
 * Last-click timestamp per "userId:adId" key – used for deduplication.
 * Entries are automatically expired in `pruneDedup()`.
 */
const lastClickTimestamp = new Map<string, number>();

// ── Flush scheduler ───────────────────────────────────────────────────────────

let flushTimer: ReturnType<typeof setInterval> | null = null;

function startFlushTimer(): void {
  if (flushTimer !== null) return;
  flushTimer = setInterval(() => {
    flushImpressions();
  }, FLUSH_INTERVAL_MS);
  // Allow Node to exit even if the timer is still running
  if (typeof flushTimer === "object" && flushTimer !== null && "unref" in flushTimer) {
    (flushTimer as NodeJS.Timeout).unref();
  }
}

/** Flush the pending impression buffer to the store. */
function flushImpressions(): void {
  const batch = pendingImpressions.splice(0);
  for (const impression of batch) {
    impressionStore.set(impression.id, impression);
  }
}

// Start the flush timer immediately when this module is loaded.
startFlushTimer();

// ── Deduplication helpers ─────────────────────────────────────────────────────

function dedupKey(adId: string, userId: string): string {
  return `${userId}:${adId}`;
}

/** Remove expired dedup entries to avoid unbounded memory growth. */
function pruneDedup(): void {
  const now = Date.now();
  for (const [key, ts] of lastClickTimestamp) {
    if (now - ts > DEDUP_WINDOW_MS) {
      lastClickTimestamp.delete(key);
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface TrackingService {
  recordImpression(adId: string, userId: string, attentionScore: number, dwellTimeMs: number): Impression;
  recordClick(adId: string, userId: string, timestamp?: string): Click;
  getImpression(impressionId: string): Impression | null;
  getClick(clickId: string): Click | null;
  getImpressionsForAd(adId: string): Impression[];
  getClicksForAd(adId: string): Click[];
  flush(): void;
  reset(): void;
}

class TrackingServiceImpl implements TrackingService {
  /**
   * Buffer an impression.  The record is held in memory until the next flush.
   */
  recordImpression(
    adId: string,
    userId: string,
    attentionScore: number,
    dwellTimeMs: number
  ): Impression {
    const impression: Impression = {
      id: randomUUID(),
      adId,
      userId,
      attentionScore: clamp(attentionScore, 0, 1),
      dwellTimeMs: Math.max(0, Math.round(dwellTimeMs)),
      createdAt: new Date().toISOString()
    };

    pendingImpressions.push(impression);
    return impression;
  }

  /**
   * Record a click.  Written immediately.
   *
   * Validation:
   *  1. There must be an impression (pending or flushed) for this adId + userId
   *     recorded within the last 30 seconds.
   *  2. There must not be a valid click from the same userId + adId within the
   *     last 60 seconds (deduplication).
   *
   * Returns a Click with `valid: false` if validation fails instead of throwing,
   * allowing callers to inspect the reason via the fraud pipeline.
   */
  recordClick(adId: string, userId: string, timestamp?: string): Click {
    pruneDedup();

    const now = Date.now();
    const clickTimestamp = timestamp ? new Date(timestamp).getTime() : now;

    // Find most recent matching impression (pending first, then store)
    const matchingImpression = this.findRecentImpression(adId, userId, clickTimestamp);

    // Deduplication check
    const key = dedupKey(adId, userId);
    const lastClick = lastClickTimestamp.get(key);
    const isDuplicate = lastClick !== undefined && (clickTimestamp - lastClick) < DEDUP_WINDOW_MS;

    const valid = matchingImpression !== null && !isDuplicate;

    if (valid) {
      lastClickTimestamp.set(key, clickTimestamp);
    }

    const click: Click = {
      id: randomUUID(),
      adId,
      userId,
      timestamp: new Date(clickTimestamp).toISOString(),
      impressionId: matchingImpression?.id ?? "",
      valid
    };

    clickStore.set(click.id, click);
    return click;
  }

  getImpression(impressionId: string): Impression | null {
    // Check flushed store first, then pending buffer
    const flushed = impressionStore.get(impressionId);
    if (flushed) return flushed;
    return pendingImpressions.find((i) => i.id === impressionId) ?? null;
  }

  getClick(clickId: string): Click | null {
    return clickStore.get(clickId) ?? null;
  }

  getImpressionsForAd(adId: string): Impression[] {
    const all: Impression[] = [];
    for (const imp of impressionStore.values()) {
      if (imp.adId === adId) all.push(imp);
    }
    for (const imp of pendingImpressions) {
      if (imp.adId === adId) all.push(imp);
    }
    return all;
  }

  getClicksForAd(adId: string): Click[] {
    const result: Click[] = [];
    for (const click of clickStore.values()) {
      if (click.adId === adId) result.push(click);
    }
    return result;
  }

  /** Force-flush pending impressions (useful in tests). */
  flush(): void {
    flushImpressions();
  }

  /** Reset all state (useful in tests). */
  reset(): void {
    impressionStore.clear();
    clickStore.clear();
    pendingImpressions = [];
    lastClickTimestamp.clear();
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private findRecentImpression(
    adId: string,
    userId: string,
    clickTimestampMs: number
  ): Impression | null {
    const cutoff = clickTimestampMs - CLICK_WINDOW_MS;

    // Search pending first (most recent)
    for (let i = pendingImpressions.length - 1; i >= 0; i--) {
      const imp = pendingImpressions[i];
      if (
        imp.adId === adId &&
        imp.userId === userId &&
        new Date(imp.createdAt).getTime() >= cutoff
      ) {
        return imp;
      }
    }

    // Search flushed store
    let best: Impression | null = null;
    for (const imp of impressionStore.values()) {
      if (
        imp.adId === adId &&
        imp.userId === userId &&
        new Date(imp.createdAt).getTime() >= cutoff
      ) {
        if (best === null || new Date(imp.createdAt) > new Date(best.createdAt)) {
          best = imp;
        }
      }
    }
    return best;
  }
}

// ── Module-level singleton ────────────────────────────────────────────────────

export const trackingService: TrackingService = new TrackingServiceImpl();

// ── Utility ───────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}
