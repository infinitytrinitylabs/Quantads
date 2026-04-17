import { randomUUID } from "node:crypto";

/**
 * BidAutopilotService
 *
 * Assists advertisers with automated bid optimization while respecting
 * strict user control. This is the legitimate form of "automated
 * bidding" (as offered by every major ad platform).
 *
 * Ethical guarantees:
 *   - Opt-in only. A policy starts in `recommend` mode; advertisers must
 *     explicitly call `setMode("auto_apply")` to let the service adjust
 *     bids itself.
 *   - Hard constraints: `maxBid`, `minBid`, and `dailyBudgetCap` are
 *     enforced every evaluation. Recommendations that would breach caps
 *     are clamped to the cap.
 *   - Full, per-change audit log with human-readable rationale.
 *   - One-click pause / disable.
 *   - No "trust the AI" messaging is emitted from the API — the caller
 *     presents recommendations neutrally and always shows the rationale.
 */

export type AutopilotMode = "recommend" | "auto_apply" | "paused";

export interface AutopilotPolicy {
  id: string;
  campaignId: string;
  advertiserId: string;
  mode: AutopilotMode;
  currentBid: number;
  minBid: number;
  maxBid: number;
  /** Max cumulative spend that may be committed per UTC day. */
  dailyBudgetCap: number;
  /** Cumulative spend committed today. */
  todaySpend: number;
  /** Percentage change allowed in a single evaluation, in [0, 1]. */
  maxAdjustmentPerStep: number;
  createdAt: string;
  updatedAt: string;
}

export interface AutopilotAuditEntry {
  id: string;
  policyId: string;
  at: string;
  fromBid: number;
  toBid: number;
  applied: boolean;
  mode: AutopilotMode;
  rationale: string;
  signals: Record<string, number>;
}

export interface AutopilotCreateInput {
  campaignId: string;
  advertiserId: string;
  startingBid: number;
  minBid: number;
  maxBid: number;
  dailyBudgetCap: number;
  maxAdjustmentPerStep?: number;
}

export interface AutopilotEvaluationInput {
  /** Observed conversion rate on the campaign. */
  conversionRate: number;
  /** Current aggregate attention score (0–1). */
  attentionScore: number;
  /** Current market pressure multiplier (1 = neutral). */
  marketPressure: number;
  /** Observed impressions attributable to current spend. */
  impressions: number;
  /** Projected additional spend that this bid adjustment would commit. */
  projectedAdditionalSpend?: number;
}

export interface AutopilotEvaluationResult {
  policyId: string;
  previousBid: number;
  recommendedBid: number;
  appliedBid: number;
  applied: boolean;
  mode: AutopilotMode;
  rationale: string;
  auditEntryId: string;
  capsEnforced: string[];
}

const DEFAULT_MAX_ADJUSTMENT = 0.15;

export class BidAutopilotService {
  private readonly policies = new Map<string, AutopilotPolicy>();
  private readonly audit = new Map<string, AutopilotAuditEntry[]>();

  createPolicy(input: AutopilotCreateInput): AutopilotPolicy {
    if (input.minBid <= 0 || input.maxBid <= input.minBid) {
      throw new Error("maxBid must be > minBid > 0");
    }
    if (input.startingBid < input.minBid || input.startingBid > input.maxBid) {
      throw new Error("startingBid must lie within [minBid, maxBid]");
    }
    if (input.dailyBudgetCap <= 0) {
      throw new Error("dailyBudgetCap must be positive");
    }

    const policy: AutopilotPolicy = {
      id: randomUUID(),
      campaignId: input.campaignId,
      advertiserId: input.advertiserId,
      mode: "recommend", // opt-in by default
      currentBid: input.startingBid,
      minBid: input.minBid,
      maxBid: input.maxBid,
      dailyBudgetCap: input.dailyBudgetCap,
      todaySpend: 0,
      maxAdjustmentPerStep: input.maxAdjustmentPerStep ?? DEFAULT_MAX_ADJUSTMENT,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.policies.set(policy.id, policy);
    this.audit.set(policy.id, []);
    return policy;
  }

  setMode(policyId: string, mode: AutopilotMode): AutopilotPolicy {
    const policy = this.requirePolicy(policyId);
    policy.mode = mode;
    policy.updatedAt = new Date().toISOString();
    return policy;
  }

  resetDailySpend(policyId: string): AutopilotPolicy {
    const policy = this.requirePolicy(policyId);
    policy.todaySpend = 0;
    policy.updatedAt = new Date().toISOString();
    return policy;
  }

  getPolicy(policyId: string): AutopilotPolicy | null {
    return this.policies.get(policyId) ?? null;
  }

  getAudit(policyId: string): AutopilotAuditEntry[] {
    return (this.audit.get(policyId) ?? []).slice();
  }

  evaluate(policyId: string, input: AutopilotEvaluationInput): AutopilotEvaluationResult {
    const policy = this.requirePolicy(policyId);
    const capsEnforced: string[] = [];

    const conversionRate = clamp01(input.conversionRate);
    const attention = clamp01(input.attentionScore);
    const pressure = Math.max(0.1, input.marketPressure);

    const performanceSignal = 0.6 * conversionRate + 0.4 * attention;
    // centered target is 0.5: above → raise, below → lower
    const desiredDelta = (performanceSignal - 0.5) * 2 * policy.maxAdjustmentPerStep;
    const pressureAdjustment = (pressure - 1) * 0.5 * policy.maxAdjustmentPerStep;

    const uncapped = policy.currentBid * (1 + desiredDelta + pressureAdjustment);

    let recommended = uncapped;
    if (recommended < policy.minBid) {
      recommended = policy.minBid;
      capsEnforced.push("minBid");
    }
    if (recommended > policy.maxBid) {
      recommended = policy.maxBid;
      capsEnforced.push("maxBid");
    }

    // Clamp the single-step change even if performance wants more
    const maxStepBid = policy.currentBid * (1 + policy.maxAdjustmentPerStep);
    const minStepBid = policy.currentBid * (1 - policy.maxAdjustmentPerStep);
    if (recommended > maxStepBid) {
      recommended = maxStepBid;
      capsEnforced.push("maxAdjustmentPerStep");
    }
    if (recommended < minStepBid) {
      recommended = minStepBid;
      capsEnforced.push("minAdjustmentPerStep");
    }

    recommended = Number(recommended.toFixed(4));

    const projectedAdditionalSpend = input.projectedAdditionalSpend ?? 0;
    const projectedTodaySpend = policy.todaySpend + projectedAdditionalSpend;
    let applied = policy.mode === "auto_apply";

    if (applied && projectedTodaySpend > policy.dailyBudgetCap) {
      applied = false;
      capsEnforced.push("dailyBudgetCap");
    }

    const previousBid = policy.currentBid;
    if (applied) {
      policy.currentBid = recommended;
      policy.todaySpend = projectedTodaySpend;
      policy.updatedAt = new Date().toISOString();
    }

    const rationale = buildRationale({
      performanceSignal,
      pressure,
      recommendedBid: recommended,
      previousBid,
      applied,
      mode: policy.mode,
      capsEnforced
    });

    const entry: AutopilotAuditEntry = {
      id: randomUUID(),
      policyId: policy.id,
      at: new Date().toISOString(),
      fromBid: previousBid,
      toBid: recommended,
      applied,
      mode: policy.mode,
      rationale,
      signals: {
        conversionRate,
        attentionScore: attention,
        marketPressure: pressure,
        impressions: input.impressions,
        projectedAdditionalSpend
      }
    };
    const log = this.audit.get(policy.id) ?? [];
    log.push(entry);
    this.audit.set(policy.id, log);

    return {
      policyId: policy.id,
      previousBid,
      recommendedBid: recommended,
      appliedBid: applied ? recommended : previousBid,
      applied,
      mode: policy.mode,
      rationale,
      auditEntryId: entry.id,
      capsEnforced
    };
  }

  private requirePolicy(policyId: string): AutopilotPolicy {
    const policy = this.policies.get(policyId);
    if (!policy) throw new Error(`autopilot policy ${policyId} not found`);
    return policy;
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function buildRationale(args: {
  performanceSignal: number;
  pressure: number;
  recommendedBid: number;
  previousBid: number;
  applied: boolean;
  mode: AutopilotMode;
  capsEnforced: string[];
}): string {
  const direction =
    args.recommendedBid > args.previousBid
      ? "increase"
      : args.recommendedBid < args.previousBid
      ? "decrease"
      : "hold";
  const perfPct = (args.performanceSignal * 100).toFixed(0);
  const pressurePct = ((args.pressure - 1) * 100).toFixed(0);
  const capsSuffix = args.capsEnforced.length
    ? ` Caps applied: ${args.capsEnforced.join(", ")}.`
    : "";
  const action = args.applied
    ? "Adjustment applied (auto-apply mode)."
    : args.mode === "paused"
    ? "Policy paused; adjustment not applied."
    : "Recommendation only; advertiser confirmation required before apply.";
  return (
    `Performance signal at ${perfPct}% (target 50%), market pressure ${pressurePct}% vs. neutral. ` +
    `Recommendation: ${direction} bid from ${args.previousBid.toFixed(4)} to ${args.recommendedBid.toFixed(4)}. ` +
    action +
    capsSuffix
  );
}

export const bidAutopilotService = new BidAutopilotService();
