/**
 * BidWarVisualization
 *
 * Server-side model for a real-time, Canvas-style bid-war visualisation.
 * This module produces structured rendering data that a client can consume
 * to draw a candlestick chart of live bid prices with animated "clash spark"
 * effects and sound-event notifications — without coupling to any specific
 * front-end framework.
 *
 * Architecture
 * ────────────
 * • `BidWarVisualizationEngine`  — core state machine; ingests live bid
 *   ticks and produces immutable frame snapshots.
 * • `CandlestickBuilder`         — aggregates raw ticks into OHLC candles
 *   for 1h, 24h and 7d time windows.
 * • `ClashDetector`              — detects when two competing bids converge
 *   within a configurable threshold and generates spark-animation payloads.
 * • `SoundEventEmitter`          — emits typed audio-cue events ("cha-ching",
 *   "whoosh") that the client maps to actual sound assets.
 */

import { randomUUID } from "node:crypto";

// ── Constants ──────────────────────────────────────────────────────────────────

const CLASH_THRESHOLD_FRACTION   = 0.02;   // bids within 2 % of each other
const MAX_TICKS_IN_MEMORY        = 10_000;
const MAX_CANDLES_PER_WINDOW     = 500;
const SPARK_TTL_MS               = 3_000;   // sparks expire after 3 s
const MAX_SOUND_EVENTS_IN_BUFFER = 200;

// ── Public types ───────────────────────────────────────────────────────────────

export type TimeWindow = "1h" | "24h" | "7d";

export type BidRole = "own" | "winning" | "losing";

export interface BidTick {
  tickId: string;
  campaignId: string;
  advertiserId: string;
  /** Rendered role of this bid in the visualisation. */
  role: BidRole;
  bidAmount: number;
  /** ISO-8601 timestamp. */
  timestamp: string;
  vertical: string;
}

export interface OHLCCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  /** Number of ticks aggregated into this candle. */
  volume: number;
  /** Start of the candle interval (ISO-8601). */
  intervalStart: string;
  /** Duration of the interval in milliseconds. */
  intervalMs: number;
  /** Dominant role in this candle (most-frequent BidRole). */
  dominantRole: BidRole;
}

export interface CandlestickSeries {
  window: TimeWindow;
  intervalMs: number;
  campaignId: string;
  candles: OHLCCandle[];
  updatedAt: string;
}

export interface SparkAnimation {
  sparkId: string;
  campaignId: string;
  /** The two competing bid amounts that triggered the clash. */
  bidA: number;
  bidB: number;
  /** Normalised position on the Y axis [0, 1] for rendering. */
  yPosition: number;
  /** Epoch ms when the spark should be shown. */
  triggeredAt: number;
  /** Epoch ms after which the spark should be removed. */
  expiresAt: number;
}

export type SoundCue = "cha-ching" | "whoosh" | "alert";

export interface SoundEvent {
  eventId: string;
  cue: SoundCue;
  /** Bid amount that triggered the event (for volume scaling). */
  bidAmount: number;
  campaignId: string;
  triggeredAt: string;
}

export interface VisualizationFrame {
  frameId: string;
  timestamp: string;
  /** All active ticks in the current 1-minute window, ordered newest-first. */
  liveTicks: BidTick[];
  /** Active sparks that have not yet expired. */
  activeSparks: SparkAnimation[];
  /** Most recently emitted sound events (up to last 10). */
  recentSoundEvents: SoundEvent[];
  /** Candlestick series for each time window. */
  candlestickSeries: CandlestickSeries[];
  /** Current top bid per campaign. */
  topBidsByCampaign: Record<string, { bidAmount: number; role: BidRole }>;
}

// ── Candle-interval configuration ─────────────────────────────────────────────

const WINDOW_CONFIG: Record<TimeWindow, { intervalMs: number }> = {
  "1h":  { intervalMs: 5 * 60 * 1_000         },   // 5-minute candles
  "24h": { intervalMs: 60 * 60 * 1_000        },   // 1-hour candles
  "7d":  { intervalMs: 6 * 60 * 60 * 1_000    }    // 6-hour candles
};

// ── CandlestickBuilder ────────────────────────────────────────────────────────

class CandlestickBuilder {
  private readonly seriesByWindow = new Map<TimeWindow, OHLCCandle[]>();

  constructor(private readonly campaignId: string) {
    for (const w of Object.keys(WINDOW_CONFIG) as TimeWindow[]) {
      this.seriesByWindow.set(w, []);
    }
  }

  ingestTick(tick: BidTick): void {
    const tsMs = new Date(tick.timestamp).getTime();

    for (const [window, config] of Object.entries(WINDOW_CONFIG) as [TimeWindow, { intervalMs: number }][]) {
      const intervalStart = Math.floor(tsMs / config.intervalMs) * config.intervalMs;
      const candles = this.seriesByWindow.get(window)!;

      let candle = candles.find((c) => new Date(c.intervalStart).getTime() === intervalStart);

      if (!candle) {
        candle = {
          open:          tick.bidAmount,
          high:          tick.bidAmount,
          low:           tick.bidAmount,
          close:         tick.bidAmount,
          volume:        0,
          intervalStart: new Date(intervalStart).toISOString(),
          intervalMs:    config.intervalMs,
          dominantRole:  tick.role
        };
        candles.push(candle);
        if (candles.length > MAX_CANDLES_PER_WINDOW) candles.shift();
      } else {
        candle.high  = Math.max(candle.high, tick.bidAmount);
        candle.low   = Math.min(candle.low,  tick.bidAmount);
        candle.close = tick.bidAmount;
      }

      candle.volume++;
      candle.dominantRole = this.mostFrequentRole(candles.slice(-20));
    }
  }

  getSeries(window: TimeWindow): CandlestickSeries {
    return {
      window,
      intervalMs: WINDOW_CONFIG[window].intervalMs,
      campaignId: this.campaignId,
      candles:    [...(this.seriesByWindow.get(window) ?? [])],
      updatedAt:  new Date().toISOString()
    };
  }

  private mostFrequentRole(candles: OHLCCandle[]): BidRole {
    const counts: Record<BidRole, number> = { own: 0, winning: 0, losing: 0 };
    for (const c of candles) counts[c.dominantRole]++;
    return (Object.entries(counts) as [BidRole, number][])
      .sort((a, b) => b[1] - a[1])[0][0];
  }
}

// ── ClashDetector ─────────────────────────────────────────────────────────────

class ClashDetector {
  /**
   * Given the two highest bids in a campaign, return a SparkAnimation if they
   * are within CLASH_THRESHOLD_FRACTION of each other; null otherwise.
   */
  evaluate(
    campaignId: string,
    bidA: number,
    bidB: number,
    referenceMax: number
  ): SparkAnimation | null {
    if (bidA <= 0 || bidB <= 0) return null;
    const higher = Math.max(bidA, bidB);
    const lower  = Math.min(bidA, bidB);
    const gap    = (higher - lower) / higher;

    if (gap > CLASH_THRESHOLD_FRACTION) return null;

    const now      = Date.now();
    const yPosition = referenceMax > 0 ? higher / referenceMax : 0.5;

    return {
      sparkId:     randomUUID(),
      campaignId,
      bidA,
      bidB,
      yPosition:   Math.min(1, Math.max(0, yPosition)),
      triggeredAt: now,
      expiresAt:   now + SPARK_TTL_MS
    };
  }
}

// ── SoundEventEmitter ─────────────────────────────────────────────────────────

class SoundEventEmitter {
  private readonly buffer: SoundEvent[] = [];
  private listener: ((event: SoundEvent) => void) | null = null;

  onEvent(listener: (event: SoundEvent) => void): void {
    this.listener = listener;
  }

  emitWin(campaignId: string, bidAmount: number): SoundEvent {
    return this.emit("cha-ching", campaignId, bidAmount);
  }

  emitOutbid(campaignId: string, bidAmount: number): SoundEvent {
    return this.emit("whoosh", campaignId, bidAmount);
  }

  emitAlert(campaignId: string, bidAmount: number): SoundEvent {
    return this.emit("alert", campaignId, bidAmount);
  }

  getRecent(limit = 10): SoundEvent[] {
    return this.buffer.slice(-limit);
  }

  private emit(cue: SoundCue, campaignId: string, bidAmount: number): SoundEvent {
    const event: SoundEvent = {
      eventId:     randomUUID(),
      cue,
      bidAmount,
      campaignId,
      triggeredAt: new Date().toISOString()
    };
    this.buffer.push(event);
    if (this.buffer.length > MAX_SOUND_EVENTS_IN_BUFFER) this.buffer.shift();
    if (this.listener) this.listener(event);
    return event;
  }
}

// ── BidWarVisualizationEngine (main class) ────────────────────────────────────

export class BidWarVisualizationEngine {
  private readonly ticks:          BidTick[]    = [];
  private readonly sparks:         SparkAnimation[] = [];
  private readonly candleBuilders  = new Map<string, CandlestickBuilder>();
  private readonly clashDetector   = new ClashDetector();
  readonly soundEmitter            = new SoundEventEmitter();

  /** Previous top-bid per campaign to detect win/outbid transitions. */
  private readonly prevTopBid      = new Map<string, { amount: number; role: BidRole }>();

  // ── Ingestion ────────────────────────────────────────────────────────────────

  /**
   * Ingest a live bid tick.  Automatically:
   *  1. Updates the tick buffer (trimmed to MAX_TICKS_IN_MEMORY).
   *  2. Feeds all candlestick builders.
   *  3. Runs clash detection and adds sparks when bids are close.
   *  4. Emits sound events for wins and outbids.
   */
  ingestTick(tick: BidTick): void {
    const withId: BidTick = tick.tickId ? tick : { ...tick, tickId: randomUUID() };

    this.ticks.push(withId);
    if (this.ticks.length > MAX_TICKS_IN_MEMORY) this.ticks.shift();

    // Update / create candle builder for this campaign
    if (!this.candleBuilders.has(withId.campaignId)) {
      this.candleBuilders.set(withId.campaignId, new CandlestickBuilder(withId.campaignId));
    }
    this.candleBuilders.get(withId.campaignId)!.ingestTick(withId);

    // Sound-event logic
    const prev = this.prevTopBid.get(withId.campaignId);
    if (!prev) {
      // First tick for this campaign — treat as initial win
      if (withId.role === "winning") {
        this.soundEmitter.emitWin(withId.campaignId, withId.bidAmount);
      }
    } else {
      if (withId.role === "winning" && prev.role !== "winning") {
        this.soundEmitter.emitWin(withId.campaignId, withId.bidAmount);
      } else if (withId.role === "losing" && prev.role === "winning") {
        this.soundEmitter.emitOutbid(withId.campaignId, withId.bidAmount);
      }
    }

    this.prevTopBid.set(withId.campaignId, {
      amount: withId.bidAmount,
      role:   withId.role
    });

    // Clash detection: compare the two highest bids for this campaign
    const campaignTicks = this.ticks
      .filter((t) => t.campaignId === withId.campaignId)
      .slice(-50);

    const topTwo = campaignTicks
      .sort((a, b) => b.bidAmount - a.bidAmount)
      .slice(0, 2);

    if (topTwo.length === 2) {
      const allBids   = this.ticks.map((t) => t.bidAmount);
      const refMax    = allBids.length ? Math.max(...allBids) : 1;
      const spark     = this.clashDetector.evaluate(
        withId.campaignId,
        topTwo[0].bidAmount,
        topTwo[1].bidAmount,
        refMax
      );
      if (spark) {
        this.sparks.push(spark);
        this.soundEmitter.emitAlert(withId.campaignId, topTwo[0].bidAmount);
      }
    }

    // Prune expired sparks
    this.pruneExpiredSparks();
  }

  // ── Frame snapshot ────────────────────────────────────────────────────────────

  /**
   * Produce an immutable frame snapshot suitable for JSON serialisation and
   * transmission to a connected client.
   */
  getFrame(): VisualizationFrame {
    this.pruneExpiredSparks();

    const oneMinuteAgo  = Date.now() - 60_000;
    const liveTicks     = this.ticks
      .filter((t) => new Date(t.timestamp).getTime() >= oneMinuteAgo)
      .slice()
      .reverse();

    const allWindows: TimeWindow[] = ["1h", "24h", "7d"];
    const candlestickSeries: CandlestickSeries[] = [];
    for (const [, builder] of this.candleBuilders) {
      for (const w of allWindows) {
        candlestickSeries.push(builder.getSeries(w));
      }
    }

    const topBidsByCampaign: Record<string, { bidAmount: number; role: BidRole }> = {};
    for (const [campaignId, top] of this.prevTopBid) {
      topBidsByCampaign[campaignId] = { bidAmount: top.amount, role: top.role };
    }

    return {
      frameId:           randomUUID(),
      timestamp:         new Date().toISOString(),
      liveTicks,
      activeSparks:      this.sparks.slice(),
      recentSoundEvents: this.soundEmitter.getRecent(10),
      candlestickSeries,
      topBidsByCampaign
    };
  }

  // ── Candle queries ────────────────────────────────────────────────────────────

  getCandlestickSeries(campaignId: string, window: TimeWindow): CandlestickSeries | null {
    return this.candleBuilders.get(campaignId)?.getSeries(window) ?? null;
  }

  // ── Sound listener ────────────────────────────────────────────────────────────

  onSoundEvent(listener: (event: SoundEvent) => void): void {
    this.soundEmitter.onEvent(listener);
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private pruneExpiredSparks(): void {
    const now = Date.now();
    let i = 0;
    while (i < this.sparks.length) {
      if (this.sparks[i].expiresAt <= now) {
        this.sparks.splice(i, 1);
      } else {
        i++;
      }
    }
  }
}

// ── Module-level singleton ─────────────────────────────────────────────────────

export const bidWarVisualizationEngine = new BidWarVisualizationEngine();
