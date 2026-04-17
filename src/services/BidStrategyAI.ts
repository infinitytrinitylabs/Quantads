import { randomUUID } from "node:crypto";

/**
 * BidStrategyAI
 *
 * Automated bid optimisation helpers for Quantads advertisers.
 *
 * Design principles
 * ─────────────────
 * - Every automated action requires an explicit opt-in (`mode: "auto_apply"`).
 * - Hard constraints (minBid, maxBid, dailyBudgetCap) are enforced on every
 *   evaluation.  Recommendations that would breach a cap are clamped and
 *   flagged in `capsEnforced`.
 * - The what-if simulator runs entirely in-memory and never mutates live
 *   strategy state.
 * - Full, per-change audit log with human-readable rationale.
 */

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_MAX_STEP_FRACTION  = 0.20;   // max 20 % change per evaluation
const DEFAULT_TARGET_ROAS        = 2.0;    // pause below 2× return on ad spend
const HOURS_IN_DAY               = 24;
const DAYS_IN_WEEK               = 7;

// ── Public types ───────────────────────────────────────────────────────────────

export type StrategyMode = "recommend" | "auto_apply" | "paused";
export type PacingMode   = "even" | "front_load" | "back_load";

/** Historical performance snapshot used by the auto-optimizer. */
export interface PerformanceSnapshot {
  /** Hour of the day (0–23). */
  hour: number;
  /** Day of the week (0 = Sunday … 6 = Saturday). */
  dayOfWeek: number;
  /** Observed ROAS for this slot (revenue / spend). */
  roas: number;
  /** Observed conversion rate for this slot (0–1). */
  conversionRate: number;
  /** Number of auctions entered during this slot. */
  auctionCount: number;
}

export interface BidStrategy {
  id: string;
  campaignId: string;
  advertiserId: string;
  mode: StrategyMode;
  pacingMode: PacingMode;
  currentBid: number;
  minBid: number;
  maxBid: number;
  dailyBudgetCap: number;
  todaySpend: number;
  targetRoas: number;
  maxStepFraction: number;
  createdAt: string;
  updatedAt: string;
}

export interface BidStrategyCreateInput {
  campaignId: string;
  advertiserId: string;
  startingBid: number;
  minBid: number;
  maxBid: number;
  dailyBudgetCap: number;
  targetRoas?: number;
  maxStepFraction?: number;
  pacingMode?: PacingMode;
}

export interface OptimizerInput {
  /** Current wall-clock hour (0–23). Defaults to actual UTC hour if omitted. */
  hour?: number;
  /** Current day of week (0–6). Defaults to actual UTC day if omitted. */
  dayOfWeek?: number;
  /** Recent performance snapshots (used for intra-day pattern fitting). */
  history: PerformanceSnapshot[];
  /** Additional spend that this evaluation would commit. */
  projectedAdditionalSpend?: number;
}

export interface OptimizerResult {
  strategyId: string;
  previousBid: number;
  recommendedBid: number;
  appliedBid: number;
  applied: boolean;
  mode: StrategyMode;
  rationale: string;
  auditEntryId: string;
  capsEnforced: string[];
  pacingMultiplier: number;
  roasTriggeredPause: boolean;
}

export interface AuditEntry {
  id: string;
  strategyId: string;
  at: string;
  fromBid: number;
  toBid: number;
  applied: boolean;
  mode: StrategyMode;
  rationale: string;
  signals: Record<string, number>;
}

// ── What-if simulation ────────────────────────────────────────────────────────

export interface WhatIfScenario {
  label: string;
  bidAmount: number;
  pacingMode: PacingMode;
  targetRoas: number;
  dailyBudgetCap: number;
}

export interface WhatIfAuctionEvent {
  hour: number;
  dayOfWeek: number;
  /** Impression opportunity cost (market floor price at this slot). */
  marketFloor: number;
  /** Observed ROAS multiplier at this slot (from historical data). */
  slotRoas: number;
  /** Number of impression opportunities in this slot. */
  opportunities: number;
}

export interface WhatIfResult {
  scenarioLabel: string;
  bidAmount: number;
  pacingMode: PacingMode;
  totalSpend: number;
  totalRevenue: number;
  effectiveRoas: number;
  auctionsWon: number;
  auctionsEntered: number;
  winRate: number;
  budgetUtilization: number;
  roasPauseTriggered: boolean;
  hourlyBreakdown: Array<{
    hour: number;
    spend: number;
    revenue: number;
    wins: number;
  }>;
}

// ── Budget-pacing helpers ─────────────────────────────────────────────────────

/**
 * Returns a fraction of the daily budget to spend in a given hour.
 *
 * - `even`:       uniform 1/24 per hour
 * - `front_load`: higher weight in hours 0–11, tapering off
 * - `back_load`:  higher weight in hours 12–23
 */
function hourlyPacingWeight(hour: number, mode: PacingMode): number {
  switch (mode) {
    case "even":
      return 1 / HOURS_IN_DAY;

    case "front_load": {
      // Triangle distribution peaking at hour 6
      const raw = hour < 12 ? (12 - Math.abs(hour - 6)) : Math.max(0, 6 - (hour - 12));
      const weights = Array.from({ length: HOURS_IN_DAY }, (_, h) =>
        h < 12 ? 12 - Math.abs(h - 6) : Math.max(0, 6 - (h - 12))
      );
      const total = weights.reduce((a, b) => a + b, 0);
      return raw / total;
    }

    case "back_load": {
      // Triangle distribution peaking at hour 18
      const raw = hour >= 12
        ? (12 - Math.abs(hour - 18))
        : Math.max(0, 6 - (12 - hour));
      const weights = Array.from({ length: HOURS_IN_DAY }, (_, h) =>
        h >= 12 ? 12 - Math.abs(h - 18) : Math.max(0, 6 - (12 - h))
      );
      const total = weights.reduce((a, b) => a + b, 0);
      return raw / total;
    }
  }
}

/**
 * Derives an additive bid-scaling multiplier from historical performance at
 * the given (hour, dayOfWeek) slot.
 *
 * Uses a weighted average of recent ROAS values at the same hour and day-of-
 * week pair, normalised against the overall average.  Returns 1.0 (neutral)
 * when no matching history is available.
 */
function slotPerformanceMultiplier(
  hour: number,
  dayOfWeek: number,
  history: PerformanceSnapshot[]
): number {
  if (!history.length) return 1;

  // Weight: exact (hour, day) match = 4, same hour = 2, same day = 1
  type WeightedROAS = { weight: number; roas: number };
  const weighted: WeightedROAS[] = [];

  for (const snap of history) {
    const sameHour = snap.hour === hour;
    const sameDay  = snap.dayOfWeek === dayOfWeek;

    const weight =
      sameHour && sameDay ? 4 :
      sameHour            ? 2 :
      sameDay             ? 1 : 0;

    if (weight > 0) {
      weighted.push({ weight, roas: snap.roas });
    }
  }

  if (!weighted.length) return 1;

  const totalWeight = weighted.reduce((a, b) => a + b.weight, 0);
  const weightedRoas = weighted.reduce((a, b) => a + b.weight * b.roas, 0) / totalWeight;

  const allRoasAvg = history.reduce((a, b) => a + b.roas, 0) / history.length;
  if (allRoasAvg === 0) return 1;

  return Math.min(2.0, Math.max(0.5, weightedRoas / allRoasAvg));
}

// ── Main service class ────────────────────────────────────────────────────────

export class BidStrategyAIService {
  private readonly strategies  = new Map<string, BidStrategy>();
  private readonly auditLog    = new Map<string, AuditEntry[]>();

  // ── CRUD ─────────────────────────────────────────────────────────────────────

  createStrategy(input: BidStrategyCreateInput): BidStrategy {
    if (input.minBid <= 0 || input.maxBid <= input.minBid) {
      throw new Error("maxBid must be > minBid > 0");
    }
    if (input.startingBid < input.minBid || input.startingBid > input.maxBid) {
      throw new Error("startingBid must lie within [minBid, maxBid]");
    }
    if (input.dailyBudgetCap <= 0) {
      throw new Error("dailyBudgetCap must be positive");
    }

    const strategy: BidStrategy = {
      id:                 randomUUID(),
      campaignId:         input.campaignId,
      advertiserId:       input.advertiserId,
      mode:               "recommend",
      pacingMode:         input.pacingMode ?? "even",
      currentBid:         input.startingBid,
      minBid:             input.minBid,
      maxBid:             input.maxBid,
      dailyBudgetCap:     input.dailyBudgetCap,
      todaySpend:         0,
      targetRoas:         input.targetRoas ?? DEFAULT_TARGET_ROAS,
      maxStepFraction:    input.maxStepFraction ?? DEFAULT_MAX_STEP_FRACTION,
      createdAt:          new Date().toISOString(),
      updatedAt:          new Date().toISOString()
    };

    this.strategies.set(strategy.id, strategy);
    this.auditLog.set(strategy.id, []);
    return { ...strategy };
  }

  setMode(strategyId: string, mode: StrategyMode): BidStrategy {
    const s = this.requireStrategy(strategyId);
    s.mode      = mode;
    s.updatedAt = new Date().toISOString();
    return { ...s };
  }

  setPacingMode(strategyId: string, pacingMode: PacingMode): BidStrategy {
    const s = this.requireStrategy(strategyId);
    s.pacingMode = pacingMode;
    s.updatedAt  = new Date().toISOString();
    return { ...s };
  }

  resetDailySpend(strategyId: string): BidStrategy {
    const s = this.requireStrategy(strategyId);
    s.todaySpend = 0;
    s.updatedAt  = new Date().toISOString();
    return { ...s };
  }

  getStrategy(strategyId: string): BidStrategy | null {
    const s = this.strategies.get(strategyId);
    return s ? { ...s } : null;
  }

  getAudit(strategyId: string): AuditEntry[] {
    return (this.auditLog.get(strategyId) ?? []).slice();
  }

  // ── Auto-optimizer ────────────────────────────────────────────────────────────

  /**
   * Evaluate the current bid against recent performance signals and optionally
   * apply the resulting recommendation.
   *
   * Steps:
   *  1. Compute a slot-performance multiplier from historical ROAS at (hour, dayOfWeek).
   *  2. Compute a pacing multiplier that amplifies or dampens the bid based on
   *     how much of today's budget has been spent relative to the pacing curve.
   *  3. Clamp the combined recommendation within [minBid, maxBid] and
   *     [±maxStepFraction] of the current bid.
   *  4. Check ROAS: if average historical ROAS is below targetRoas, pause.
   *  5. Enforce dailyBudgetCap.
   *  6. Write an audit log entry.
   */
  evaluate(strategyId: string, input: OptimizerInput): OptimizerResult {
    const s = this.requireStrategy(strategyId);
    const capsEnforced: string[] = [];

    const now       = new Date();
    const hour      = input.hour      ?? now.getUTCHours();
    const dayOfWeek = input.dayOfWeek ?? now.getUTCDay();

    // 1. Slot-performance multiplier
    const slotMult = slotPerformanceMultiplier(hour, dayOfWeek, input.history);

    // 2. Pacing multiplier
    const targetFractionSpentByNow = this.cumulativePacingFraction(hour, s.pacingMode);
    const actualFractionSpent      = s.dailyBudgetCap > 0
      ? s.todaySpend / s.dailyBudgetCap
      : 0;
    const pacingGap      = targetFractionSpentByNow - actualFractionSpent;
    // Positive gap → ahead of spend → reduce bid; negative → behind → raise bid
    const pacingMult     = Math.min(1.5, Math.max(0.5, 1 - pacingGap * 2));

    // 3. Combined recommendation
    let recommended = s.currentBid * slotMult * pacingMult;

    const maxStep = s.currentBid * (1 + s.maxStepFraction);
    const minStep = s.currentBid * (1 - s.maxStepFraction);
    if (recommended > maxStep) { recommended = maxStep; capsEnforced.push("maxStepFraction"); }
    if (recommended < minStep) { recommended = minStep; capsEnforced.push("minStepFraction"); }
    if (recommended > s.maxBid) { recommended = s.maxBid; capsEnforced.push("maxBid"); }
    if (recommended < s.minBid) { recommended = s.minBid; capsEnforced.push("minBid"); }
    recommended = Number(recommended.toFixed(4));

    // 4. ROAS guard — pause if avg historical ROAS is below target
    let roasPause = false;
    if (input.history.length) {
      const avgRoas = input.history.reduce((a, b) => a + b.roas, 0) / input.history.length;
      if (avgRoas < s.targetRoas && s.mode === "auto_apply") {
        roasPause = true;
        capsEnforced.push("targetRoasPause");
      }
    }

    // 5. Budget cap
    const projectedSpend = input.projectedAdditionalSpend ?? 0;
    const budgetExceeded = s.todaySpend + projectedSpend > s.dailyBudgetCap;
    if (budgetExceeded && s.mode === "auto_apply") {
      capsEnforced.push("dailyBudgetCap");
    }

    const applied = s.mode === "auto_apply" && !roasPause && !budgetExceeded;
    const previousBid = s.currentBid;

    if (applied) {
      s.currentBid  = recommended;
      s.todaySpend += projectedSpend;
      s.updatedAt   = new Date().toISOString();
    }

    const rationale = buildRationale({
      slotMult, pacingMult, hour, dayOfWeek,
      previousBid, recommendedBid: recommended,
      applied, mode: s.mode, capsEnforced, roasPause
    });

    const entry: AuditEntry = {
      id:         randomUUID(),
      strategyId: s.id,
      at:         new Date().toISOString(),
      fromBid:    previousBid,
      toBid:      recommended,
      applied,
      mode:       s.mode,
      rationale,
      signals: {
        hour, dayOfWeek, slotMult, pacingMult,
        projectedAdditionalSpend: projectedSpend,
        todaySpend: s.todaySpend
      }
    };
    const log = this.auditLog.get(s.id) ?? [];
    log.push(entry);
    this.auditLog.set(s.id, log);

    return {
      strategyId: s.id,
      previousBid,
      recommendedBid: recommended,
      appliedBid: applied ? recommended : previousBid,
      applied,
      mode: s.mode,
      rationale,
      auditEntryId: entry.id,
      capsEnforced,
      pacingMultiplier: Number(pacingMult.toFixed(4)),
      roasTriggeredPause: roasPause
    };
  }

  // ── ROAS maximiser ────────────────────────────────────────────────────────────

  /**
   * Evaluate all active `auto_apply` strategies and pause those whose average
   * ROAS over `history` falls below their `targetRoas`.
   *
   * Returns the list of strategy IDs that were paused.
   */
  pauseBelowTargetRoas(history: PerformanceSnapshot[]): string[] {
    if (!history.length) return [];

    const avgRoas = history.reduce((a, b) => a + b.roas, 0) / history.length;
    const paused: string[] = [];

    for (const [id, s] of this.strategies) {
      if (s.mode === "auto_apply" && avgRoas < s.targetRoas) {
        s.mode      = "paused";
        s.updatedAt = new Date().toISOString();
        paused.push(id);
      }
    }
    return paused;
  }

  // ── What-if simulator ─────────────────────────────────────────────────────────

  /**
   * Simulate one or more bid scenarios over a series of auction events without
   * touching any live strategy state.
   *
   * Each scenario is evaluated independently.  The simulator honours:
   * - `dailyBudgetCap` (stops spending when exhausted)
   * - `targetRoas` (pauses when observed ROAS drops below target)
   * - `pacingMode` (applies hourly budget weights)
   */
  simulate(scenarios: WhatIfScenario[], events: WhatIfAuctionEvent[]): WhatIfResult[] {
    return scenarios.map((scenario) => this.simulateScenario(scenario, events));
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private requireStrategy(strategyId: string): BidStrategy {
    const s = this.strategies.get(strategyId);
    if (!s) throw new Error(`bid strategy ${strategyId} not found`);
    return s;
  }

  /**
   * Cumulative fraction of daily budget that the pacing curve expects to have
   * been spent by the *end* of `hour`.
   */
  private cumulativePacingFraction(hour: number, mode: PacingMode): number {
    let total = 0;
    for (let h = 0; h <= hour; h++) {
      total += hourlyPacingWeight(h, mode);
    }
    return Math.min(1, total);
  }

  private simulateScenario(
    scenario: WhatIfScenario,
    events: WhatIfAuctionEvent[]
  ): WhatIfResult {
    let remainingBudget = scenario.dailyBudgetCap;
    let totalSpend      = 0;
    let totalRevenue    = 0;
    let auctionsWon     = 0;
    let auctionsEntered = 0;
    let roasPaused      = false;

    // Hour-level aggregation for breakdown
    const hourly = new Map<number, { spend: number; revenue: number; wins: number }>();

    for (let h = 0; h < HOURS_IN_DAY; h++) {
      hourly.set(h, { spend: 0, revenue: 0, wins: 0 });
    }

    for (const event of events) {
      if (remainingBudget <= 0) break;
      if (roasPaused) break;

      const pacingWeight  = hourlyPacingWeight(event.hour, scenario.pacingMode);
      const hourBudget    = scenario.dailyBudgetCap * pacingWeight;
      const hourData      = hourly.get(event.hour) ?? { spend: 0, revenue: 0, wins: 0 };

      // Check per-hour budget headroom
      const hourHeadroom  = Math.max(0, hourBudget - hourData.spend);
      const slotBid       = Math.min(scenario.bidAmount, hourHeadroom, remainingBudget);

      for (let opp = 0; opp < event.opportunities; opp++) {
        if (remainingBudget <= 0) break;
        auctionsEntered++;

        const win = slotBid >= event.marketFloor;
        if (win) {
          const cost    = event.marketFloor; // second-price proxy
          const revenue = cost * event.slotRoas;

          totalSpend    += cost;
          totalRevenue  += revenue;
          remainingBudget -= cost;
          auctionsWon++;

          hourData.spend   += cost;
          hourData.revenue += revenue;
          hourData.wins    += 1;
        }
      }

      hourly.set(event.hour, hourData);

      // ROAS guard: check running ROAS against target
      if (totalSpend > 0) {
        const runningRoas = totalRevenue / totalSpend;
        if (runningRoas < scenario.targetRoas && auctionsWon >= 10) {
          roasPaused = true;
        }
      }
    }

    const effectiveRoas     = totalSpend > 0 ? totalRevenue / totalSpend : 0;
    const winRate           = auctionsEntered > 0 ? auctionsWon / auctionsEntered : 0;
    const budgetUtilization = scenario.dailyBudgetCap > 0
      ? totalSpend / scenario.dailyBudgetCap
      : 0;

    const hourlyBreakdown = Array.from({ length: HOURS_IN_DAY }, (_, h) => {
      const data = hourly.get(h) ?? { spend: 0, revenue: 0, wins: 0 };
      return { hour: h, spend: Number(data.spend.toFixed(4)), revenue: Number(data.revenue.toFixed(4)), wins: data.wins };
    });

    return {
      scenarioLabel:      scenario.label,
      bidAmount:          scenario.bidAmount,
      pacingMode:         scenario.pacingMode,
      totalSpend:         Number(totalSpend.toFixed(4)),
      totalRevenue:       Number(totalRevenue.toFixed(4)),
      effectiveRoas:      Number(effectiveRoas.toFixed(4)),
      auctionsWon,
      auctionsEntered,
      winRate:            Number(winRate.toFixed(4)),
      budgetUtilization:  Number(budgetUtilization.toFixed(4)),
      roasPauseTriggered: roasPaused,
      hourlyBreakdown
    };
  }
}

// ── Rationale builder ─────────────────────────────────────────────────────────

function buildRationale(args: {
  slotMult: number;
  pacingMult: number;
  hour: number;
  dayOfWeek: number;
  previousBid: number;
  recommendedBid: number;
  applied: boolean;
  mode: StrategyMode;
  capsEnforced: string[];
  roasPause: boolean;
}): string {
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
  const direction =
    args.recommendedBid > args.previousBid ? "increase" :
    args.recommendedBid < args.previousBid ? "decrease" : "hold";

  const slotPct   = ((args.slotMult   - 1) * 100).toFixed(1);
  const pacingPct = ((args.pacingMult - 1) * 100).toFixed(1);
  const capsSuffix = args.capsEnforced.length
    ? ` Caps applied: ${args.capsEnforced.join(", ")}.`
    : "";

  const action = args.roasPause
    ? "Auto-apply paused: ROAS below target."
    : args.applied
    ? "Adjustment applied (auto-apply mode)."
    : args.mode === "paused"
    ? "Policy paused; adjustment not applied."
    : "Recommendation only; advertiser confirmation required.";

  return (
    `Slot ${DAYS[args.dayOfWeek]} ${String(args.hour).padStart(2, "0")}:00 — ` +
    `slot performance ${slotPct}% vs average, pacing ${pacingPct}% vs neutral. ` +
    `Recommendation: ${direction} bid from ${args.previousBid.toFixed(4)} to ` +
    `${args.recommendedBid.toFixed(4)}. ` +
    action +
    capsSuffix
  );
}

// ── Module-level singleton ────────────────────────────────────────────────────

export const bidStrategyAIService = new BidStrategyAIService();
