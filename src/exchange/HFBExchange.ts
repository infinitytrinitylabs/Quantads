/**
 * HFBExchange – High-Frequency Bidding Exchange
 *
 * Implements a lock-free ring-buffer exchange that mirrors the producer/consumer
 * semantics of Redis Streams without an external dependency.  Each bid is assigned
 * a monotonically-increasing stream ID and processed in FIFO order.
 *
 * Design goals:
 *  - O(1) enqueue and O(n) drain (batch consumption)
 *  - Bounded memory via configurable ring-buffer capacity
 *  - BCI attention score integrated into clearing-price calculation
 *  - Clearing price uses second-price auction (Vickrey) semantics
 */

export interface ExchangeBid {
  bidId: string;
  advertiserId: string;
  adSlotId: string;
  cpcBid: number;           // Cost-per-click base bid (USD)
  attentionScore: number;   // BCI attention score 0.0–1.0
  submittedAt: string;
}

export interface ClearedBid {
  streamId: string;         // monotonic stream ID, mirrors Redis stream entry ID
  bidId: string;
  advertiserId: string;
  adSlotId: string;
  baseCpc: number;
  attentionMultiplier: number;
  effectiveCpc: number;     // baseCpc × attentionMultiplier
  clearingPrice: number;    // Vickrey second-price clearing
  won: boolean;
  processedAt: string;
}

export interface ExchangeStats {
  totalSubmitted: number;
  totalProcessed: number;
  totalDropped: number;     // dropped due to ring-buffer overflow
  activeBids: number;       // bids currently waiting in buffer
  lastClearedSlots: string[];
}

// Attention multiplier: maps [0,1] → [0.6, 1.8]
// A fully-attentive audience commands a 1.8× premium; a distracted one floors at 0.6×.
const ATTENTION_MIN_MULTIPLIER = 0.6;
const ATTENTION_MAX_MULTIPLIER = 1.8;

export function attentionCpcMultiplier(attentionScore: number): number {
  const clamped = Math.min(Math.max(attentionScore, 0), 1);
  return Number(
    (ATTENTION_MIN_MULTIPLIER + clamped * (ATTENTION_MAX_MULTIPLIER - ATTENTION_MIN_MULTIPLIER)).toFixed(4)
  );
}

export class HFBExchange {
  private readonly buffer: ExchangeBid[];
  private head = 0;
  private tail = 0;
  private count = 0;
  private streamCounter = 0;
  private clearCounter = 0;

  private totalSubmitted = 0;
  private totalProcessed = 0;
  private totalDropped = 0;
  private lastClearedSlots: string[] = [];

  constructor(private readonly capacity: number = 65_536) {
    this.buffer = new Array<ExchangeBid>(capacity);
  }

  /**
   * Enqueue a bid.  Returns the stream ID assigned to it or null if the buffer
   * is full (back-pressure signal – caller should retry or shed load).
   */
  submit(bid: ExchangeBid): string | null {
    this.totalSubmitted++;

    if (this.count >= this.capacity) {
      this.totalDropped++;
      return null;
    }

    this.buffer[this.tail] = bid;
    this.tail = (this.tail + 1) % this.capacity;
    this.count++;
    this.streamCounter++;

    // Redis-style stream ID: <milliseconds>-<sequence>
    return `${Date.now()}-${this.streamCounter}`;
  }

  /**
   * Drain up to `maxBids` bids from the buffer and run a Vickrey second-price
   * auction per ad slot.  Returns the clearing results.
   */
  drain(maxBids: number = 256): ClearedBid[] {
    const toProcess = Math.min(maxBids, this.count);

    if (toProcess === 0) {
      return [];
    }

    // Collect a batch
    const batch: ExchangeBid[] = [];
    for (let i = 0; i < toProcess; i++) {
      batch.push(this.buffer[this.head]!);
      this.head = (this.head + 1) % this.capacity;
      this.count--;
    }

    this.totalProcessed += batch.length;

    // Group by adSlotId for per-slot auctions
    const bySlot = new Map<string, ExchangeBid[]>();
    for (const bid of batch) {
      const existing = bySlot.get(bid.adSlotId) ?? [];
      existing.push(bid);
      bySlot.set(bid.adSlotId, existing);
    }

    const cleared: ClearedBid[] = [];
    const now = new Date().toISOString();
    this.lastClearedSlots = [];

    for (const [slotId, bids] of bySlot) {
      this.lastClearedSlots.push(slotId);

      // Apply attention multiplier to each bid's effective CPC
      const effective = bids.map((b) => {
        const multiplier = attentionCpcMultiplier(b.attentionScore);
        return { bid: b, multiplier, effectiveCpc: b.cpcBid * multiplier };
      });

      // Sort descending by effectiveCpc
      effective.sort((a, b) => b.effectiveCpc - a.effectiveCpc);

      // Vickrey: winner pays the second-highest price (or own price if sole bidder)
      const winnerEffective = effective[0]?.effectiveCpc ?? 0;
      const secondEffective = effective[1]?.effectiveCpc ?? winnerEffective;

      for (let idx = 0; idx < effective.length; idx++) {
        const { bid, multiplier, effectiveCpc } = effective[idx]!;
        const won = idx === 0;
        const clearingPrice = won
          ? Number(secondEffective.toFixed(4))
          : 0;

        cleared.push({
          streamId: `${Date.now()}-c${++this.clearCounter}`,
          bidId: bid.bidId,
          advertiserId: bid.advertiserId,
          adSlotId: bid.adSlotId,
          baseCpc: bid.cpcBid,
          attentionMultiplier: multiplier,
          effectiveCpc: Number(effectiveCpc.toFixed(4)),
          clearingPrice,
          won,
          processedAt: now
        });
      }
    }

    return cleared;
  }

  stats(): ExchangeStats {
    return {
      totalSubmitted: this.totalSubmitted,
      totalProcessed: this.totalProcessed,
      totalDropped: this.totalDropped,
      activeBids: this.count,
      lastClearedSlots: [...this.lastClearedSlots]
    };
  }
}

export const hfbExchange = new HFBExchange();
