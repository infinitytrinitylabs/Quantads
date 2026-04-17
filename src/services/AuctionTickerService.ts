import { EventEmitter } from "node:events";
import { createHash, randomUUID } from "node:crypto";

/**
 * AuctionTickerService
 *
 * Publishes a real-time stream of bid events for advertisers and other
 * market participants to observe market conditions. This exists for
 * **transparency**, not for manufacturing urgency.
 *
 * Ethical design choices:
 *   - Advertiser identity is pseudonymized via salted SHA-256 → opaque handle.
 *   - Advertisers may opt out (`optOut`) — their events never appear on the
 *     public stream, though they still bid normally.
 *   - Dollar amounts are bucketed to the nearest $0.10 to prevent
 *     fingerprinting individual bids.
 *   - The stream is rate-limited at the source: no more than
 *     `MAX_EVENTS_PER_SEC` events are published per second; excess events
 *     are counted as `suppressed` rather than silently dropped.
 *   - Each public event carries only category + bucketed amount + coarse
 *     timestamp + pseudonymous handle. No PII, wallet, or campaign ID.
 */

export interface RawBidEvent {
  /** Internal advertiser identifier (never leaves the service). */
  advertiserId: string;
  /** Ad category / vertical, e.g. "gaming", "travel". */
  category: string;
  /** Bid amount in USD (unrounded). */
  amount: number;
  /** ISO timestamp the bid was placed, or omitted for "now". */
  occurredAt?: string;
  /** Currency code, default USD. */
  currency?: string;
}

export interface PublicTickerEvent {
  /** Opaque pseudonymous advertiser handle; stable per advertiser per rotation period. */
  advertiserHandle: string;
  /** Ad category. */
  category: string;
  /** Bid amount bucketed to the nearest $AMOUNT_BUCKET_USD. */
  amountBucketed: number;
  /** Original currency. */
  currency: string;
  /** Timestamp truncated to the nearest second. */
  occurredAt: string;
  /** Event ID for de-duplication across stream reconnections. */
  eventId: string;
}

export interface TickerSnapshot {
  events: PublicTickerEvent[];
  suppressedCount: number;
  generatedAt: string;
}

const DEFAULT_SALT = process.env["TICKER_PSEUDONYM_SALT"] ?? "quantads-ticker-default-salt";
const AMOUNT_BUCKET_USD = 0.1;
const MAX_EVENTS_PER_SEC = 20;
const RING_BUFFER_SIZE = 500;
const PSEUDONYM_ROTATION_MS = 1000 * 60 * 60 * 6; // 6h handle rotation

export class AuctionTickerService extends EventEmitter {
  private readonly buffer: PublicTickerEvent[] = [];
  private readonly optOuts = new Set<string>();
  private readonly salt: string;
  private readonly rotationMs: number;
  private windowStartMs = Date.now();
  private windowCount = 0;
  private suppressedCount = 0;

  constructor(options: { salt?: string; rotationMs?: number } = {}) {
    super();
    this.setMaxListeners(1024);
    this.salt = options.salt ?? DEFAULT_SALT;
    this.rotationMs = options.rotationMs ?? PSEUDONYM_ROTATION_MS;
  }

  /** Allow an advertiser to opt out of appearing on the public ticker. */
  optOut(advertiserId: string): void {
    this.optOuts.add(advertiserId);
  }

  /** Revert a prior opt-out decision. */
  optIn(advertiserId: string): void {
    this.optOuts.delete(advertiserId);
  }

  /** Returns true if a particular advertiser is currently opted out. */
  isOptedOut(advertiserId: string): boolean {
    return this.optOuts.has(advertiserId);
  }

  /** Publishes a bid event. Opt-outs are silently skipped; rate-limited. */
  publish(raw: RawBidEvent): PublicTickerEvent | null {
    if (raw.amount <= 0) {
      throw new Error("amount must be positive");
    }

    if (this.optOuts.has(raw.advertiserId)) {
      return null;
    }

    const now = Date.now();
    if (now - this.windowStartMs >= 1000) {
      this.windowStartMs = now;
      this.windowCount = 0;
    }

    if (this.windowCount >= MAX_EVENTS_PER_SEC) {
      this.suppressedCount += 1;
      return null;
    }

    this.windowCount += 1;

    const ts = raw.occurredAt ? new Date(raw.occurredAt) : new Date();
    if (Number.isNaN(ts.getTime())) {
      throw new Error("occurredAt is not a valid ISO date");
    }

    const public_: PublicTickerEvent = {
      advertiserHandle: this.pseudonymize(raw.advertiserId, ts),
      category: raw.category.toLowerCase().trim(),
      amountBucketed: bucketAmount(raw.amount),
      currency: (raw.currency ?? "USD").toUpperCase(),
      occurredAt: new Date(Math.floor(ts.getTime() / 1000) * 1000).toISOString(),
      eventId: randomUUID()
    };

    this.buffer.push(public_);
    while (this.buffer.length > RING_BUFFER_SIZE) {
      this.buffer.shift();
    }

    this.emit("event", public_);
    return public_;
  }

  /** Returns the most recent (up to `limit`) events plus a suppression counter. */
  snapshot(limit = 50): TickerSnapshot {
    const clamped = Math.max(1, Math.min(limit, RING_BUFFER_SIZE));
    return {
      events: this.buffer.slice(-clamped).slice().reverse(),
      suppressedCount: this.suppressedCount,
      generatedAt: new Date().toISOString()
    };
  }

  /** Subscribe to the live event stream. Returns an unsubscribe function. */
  subscribe(handler: (event: PublicTickerEvent) => void): () => void {
    this.on("event", handler);
    return () => this.off("event", handler);
  }

  /** Pseudonymize advertiserId with a rotating time-bucketed salt. */
  private pseudonymize(advertiserId: string, when: Date): string {
    const rotationBucket = Math.floor(when.getTime() / this.rotationMs);
    const h = createHash("sha256")
      .update(this.salt)
      .update("|")
      .update(String(rotationBucket))
      .update("|")
      .update(advertiserId)
      .digest("hex");
    return `adv_${h.slice(0, 16)}`;
  }
}

export function bucketAmount(amount: number): number {
  return Number((Math.round(amount / AMOUNT_BUCKET_USD) * AMOUNT_BUCKET_USD).toFixed(2));
}

export const auctionTickerService = new AuctionTickerService();
