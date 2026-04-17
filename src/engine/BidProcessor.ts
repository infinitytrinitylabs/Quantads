/**
 * BidProcessor – High-frequency second-price (Vickrey) auction engine.
 *
 * Design decisions:
 *  - Bids are submitted individually and accumulated in a per-campaign max-heap.
 *  - When a batch of 100 bids has accumulated (or flush() is called) the auction
 *    is resolved: the highest-scoring bid wins, but pays only $0.01 above the
 *    second-highest bid (Vickrey pricing).
 *  - BCI attention multiplier scales the base CPC before ranking:
 *      finalCpc = baseCpc × (1 + attentionScore × 4)
 *    A user with attentionScore = 1.0 therefore pays up to 5× the base CPC.
 *  - Campaign spend is tracked in-memory. Once totalSpend ≥ advertiserBudget the
 *    campaign is marked "depleted" and further bids are rejected.
 */

import { randomUUID } from "node:crypto";
import { BidRequest, BidResult, AuctionSlot, ProcessedBid } from "../types";
import { roundCurrency } from "../lib/mathUtils";

// ── Constants ─────────────────────────────────────────────────────────────────

const SECOND_PRICE_INCREMENT = 0.01;
const ATTENTION_SCALE = 4;                // finalCpc = base × (1 + attn × SCALE)
const BATCH_SIZE = 100;

// ── Heap helpers (max-heap ordered by finalCpc) ───────────────────────────────

function heapParent(i: number): number { return Math.floor((i - 1) / 2); }
function heapLeft(i: number): number   { return 2 * i + 1; }
function heapRight(i: number): number  { return 2 * i + 2; }

function heapSwap(heap: ProcessedBid[], a: number, b: number): void {
  const tmp = heap[a];
  heap[a] = heap[b];
  heap[b] = tmp;
}

/** Sift the element at index `i` upward to maintain the max-heap invariant. */
function heapSiftUp(heap: ProcessedBid[], i: number): void {
  while (i > 0) {
    const parent = heapParent(i);
    if (heap[parent].finalCpc >= heap[i].finalCpc) break;
    heapSwap(heap, parent, i);
    i = parent;
  }
}

/** Sift the element at index `i` downward to maintain the max-heap invariant. */
function heapSiftDown(heap: ProcessedBid[], i: number): void {
  const n = heap.length;
  while (true) {
    let largest = i;
    const l = heapLeft(i);
    const r = heapRight(i);
    if (l < n && heap[l].finalCpc > heap[largest].finalCpc) largest = l;
    if (r < n && heap[r].finalCpc > heap[largest].finalCpc) largest = r;
    if (largest === i) break;
    heapSwap(heap, i, largest);
    i = largest;
  }
}

/** Insert a bid into the heap. O(log n). */
function heapPush(heap: ProcessedBid[], bid: ProcessedBid): void {
  heap.push(bid);
  heapSiftUp(heap, heap.length - 1);
}

/** Extract and return the maximum element. O(log n). */
function heapPop(heap: ProcessedBid[]): ProcessedBid | undefined {
  if (heap.length === 0) return undefined;
  const top = heap[0];
  const last = heap.pop()!;
  if (heap.length > 0) {
    heap[0] = last;
    heapSiftDown(heap, 0);
  }
  return top;
}

// ── Per-campaign state ────────────────────────────────────────────────────────

interface CampaignBidState {
  budget: number;
  totalSpend: number;
  exhausted: boolean;
  pendingBids: ProcessedBid[];   // max-heap
  resolvedSlots: AuctionSlot[];
}

// ── BidProcessor ─────────────────────────────────────────────────────────────

export class BidProcessor {
  private readonly campaigns = new Map<string, CampaignBidState>();

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Submit a bid for auction.
   *
   * @returns BidResult immediately (without resolving the auction).
   *          Call `flushCampaign(campaignId)` to resolve pending bids or wait
   *          for the automatic resolution when BATCH_SIZE is reached.
   */
  submitBid(request: BidRequest): BidResult {
    const {
      campaignId,
      creativeId,
      baseCpc,
      advertiserBudget,
      attentionScore = 0
    } = request;

    const state = this.getOrCreateState(campaignId, advertiserBudget);

    if (state.exhausted) {
      return {
        campaignId,
        creativeId,
        winnerId: null,
        winnerCpc: 0,
        finalCpc: 0,
        isWinner: false,
        auctionRank: -1,
        budgetExhausted: true
      };
    }

    const finalCpc = this.applyAttentionMultiplier(baseCpc, attentionScore);

    const bid: ProcessedBid = {
      campaignId,
      creativeId,
      finalCpc,
      attentionScore,
      advertiserId: request.targetUserId
    };

    heapPush(state.pendingBids, bid);

    // Auto-resolve when batch size is reached
    if (state.pendingBids.length >= BATCH_SIZE) {
      this.flushCampaign(campaignId);
    }

    return {
      campaignId,
      creativeId,
      winnerId: null,
      winnerCpc: 0,
      finalCpc: roundCurrency(finalCpc),
      isWinner: false,
      auctionRank: 0,
      budgetExhausted: false
    };
  }

  /**
   * Resolve all pending bids for a campaign using second-price (Vickrey) auction.
   * The winner pays $0.01 above the second-highest bid.
   */
  flushCampaign(campaignId: string): AuctionSlot | null {
    const state = this.campaigns.get(campaignId);
    if (!state || state.pendingBids.length === 0) return null;

    // Drain the heap into a sorted array (highest first)
    const sorted: ProcessedBid[] = [];
    while (state.pendingBids.length > 0) {
      const bid = heapPop(state.pendingBids);
      if (bid) sorted.push(bid);
    }

    const winner = sorted[0] ?? null;
    const runnerUp = sorted[1] ?? null;

    const clearingPrice = winner
      ? roundCurrency((runnerUp?.finalCpc ?? 0) + SECOND_PRICE_INCREMENT)
      : 0;

    // Deduct from budget
    if (winner) {
      state.totalSpend = roundCurrency(state.totalSpend + clearingPrice);
      if (state.totalSpend >= state.budget) {
        state.exhausted = true;
      }
    }

    const slot: AuctionSlot = {
      slotId: randomUUID(),
      bids: sorted,
      resolvedAt: new Date().toISOString(),
      winner,
      clearingPrice
    };

    state.resolvedSlots.push(slot);

    return slot;
  }

  /** Return the last resolved auction slot for a campaign (or null). */
  getLastSlot(campaignId: string): AuctionSlot | null {
    const state = this.campaigns.get(campaignId);
    if (!state || state.resolvedSlots.length === 0) return null;
    return state.resolvedSlots[state.resolvedSlots.length - 1];
  }

  /** Return all resolved slots for a campaign. */
  getAllSlots(campaignId: string): AuctionSlot[] {
    return this.campaigns.get(campaignId)?.resolvedSlots ?? [];
  }

  /** Return total spend for a campaign. */
  getTotalSpend(campaignId: string): number {
    return this.campaigns.get(campaignId)?.totalSpend ?? 0;
  }

  /** Return whether a campaign has been marked as budget-exhausted. */
  isCampaignExhausted(campaignId: string): boolean {
    return this.campaigns.get(campaignId)?.exhausted ?? false;
  }

  /** Reset campaign state (for testing / admin). */
  resetCampaign(campaignId: string): void {
    this.campaigns.delete(campaignId);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private getOrCreateState(campaignId: string, budget: number): CampaignBidState {
    let state = this.campaigns.get(campaignId);
    if (!state) {
      state = {
        budget,
        totalSpend: 0,
        exhausted: false,
        pendingBids: [],
        resolvedSlots: []
      };
      this.campaigns.set(campaignId, state);
    } else {
      // Update budget if a higher value is supplied (e.g. budget top-up)
      if (budget > state.budget) {
        state.budget = budget;
        state.exhausted = state.totalSpend >= state.budget;
      }
    }
    return state;
  }

  /**
   * Apply the BCI attention multiplier to a base CPC.
   * finalCpc = baseCpc × (1 + attentionScore × 4)
   * Range: 1× (attention=0) to 5× (attention=1).
   */
  private applyAttentionMultiplier(baseCpc: number, attentionScore: number): number {
    const clamped = Math.min(Math.max(attentionScore, 0), 1);
    return baseCpc * (1 + clamped * ATTENTION_SCALE);
  }
}

// ── Module-level singleton ────────────────────────────────────────────────────

export const bidProcessor = new BidProcessor();
