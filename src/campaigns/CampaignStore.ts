/**
 * CampaignStore – in-memory CRUD store for ad campaigns.
 *
 * Follows the same in-memory singleton pattern used throughout the codebase
 * (e.g. BciAttentionStore, OutcomeStore).
 */

import { randomUUID } from "node:crypto";
import {
  Campaign,
  CampaignCreateRequest,
  CampaignUpdateRequest,
  CampaignAnalytics,
  DailyAnalyticsEntry,
  Impression,
  Click
} from "../types";
import { trackingService } from "../services/TrackingService";
import { roundCurrency } from "../lib/mathUtils";

// ── Helpers ───────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

// ── CampaignStore ─────────────────────────────────────────────────────────────

export class CampaignStore {
  private readonly campaigns = new Map<string, Campaign>();

  /** Create a new campaign and return it. */
  create(advertiserId: string, request: CampaignCreateRequest): Campaign {
    const id = randomUUID();
    const ts = now();
    const campaign: Campaign = {
      id,
      advertiserId,
      name: request.name,
      budget: request.budget,
      totalSpend: 0,
      status: "active",
      targetingRules: request.targetingRules ?? {},
      creatives: (request.creatives ?? []).map((c) => ({
        id: randomUUID(),
        campaignId: id,
        url: c.url,
        format: c.format,
        previewUrl: c.previewUrl,
        createdAt: ts
      })),
      createdAt: ts,
      updatedAt: ts
    };
    this.campaigns.set(id, campaign);
    return campaign;
  }

  /** Return all non-deleted campaigns for an advertiser. */
  listForAdvertiser(advertiserId: string): Campaign[] {
    const result: Campaign[] = [];
    for (const c of this.campaigns.values()) {
      if (c.advertiserId === advertiserId && c.status !== "deleted") {
        result.push(c);
      }
    }
    return result;
  }

  /** Return a single campaign by ID (null if not found or deleted). */
  get(id: string): Campaign | null {
    const c = this.campaigns.get(id);
    return c && c.status !== "deleted" ? c : null;
  }

  /** Update mutable fields and return the updated campaign. */
  update(id: string, advertiserId: string, request: CampaignUpdateRequest): Campaign | null {
    const c = this.campaigns.get(id);
    if (!c || c.advertiserId !== advertiserId || c.status === "deleted") return null;

    if (request.name !== undefined)           c.name = request.name;
    if (request.budget !== undefined)         c.budget = request.budget;
    if (request.targetingRules !== undefined) c.targetingRules = { ...c.targetingRules, ...request.targetingRules };

    // Status transitions: only active→paused and paused→active are allowed externally.
    if (request.status !== undefined) {
      if (c.status === "active" && request.status === "paused") {
        c.status = "paused";
      } else if (c.status === "paused" && request.status === "active") {
        c.status = "active";
      }
    }

    c.updatedAt = now();
    return c;
  }

  /** Soft-delete a campaign. */
  delete(id: string, advertiserId: string): boolean {
    const c = this.campaigns.get(id);
    if (!c || c.advertiserId !== advertiserId || c.status === "deleted") return false;
    c.status = "deleted";
    c.updatedAt = now();
    return true;
  }

  /** Record spend against a campaign (called by BidProcessor on auction win). */
  recordSpend(id: string, amount: number): void {
    const c = this.campaigns.get(id);
    if (!c) return;
    c.totalSpend = roundCurrency(c.totalSpend + amount);
    if (c.totalSpend >= c.budget && c.status === "active") {
      c.status = "depleted";
    }
    c.updatedAt = now();
  }

  /**
   * Build analytics for a campaign by scanning the tracking service.
   * In production this would query an OLAP store or time-series DB; here we
   * derive metrics from the in-memory tracking store for correctness.
   */
  getAnalytics(id: string): CampaignAnalytics | null {
    const c = this.campaigns.get(id);
    if (!c) return null;

    // Gather all impressions and clicks for every creative in this campaign
    const creativeIds = new Set(c.creatives.map((cr) => cr.id));
    const allImpressions: Impression[] = [];
    const allClicks: Click[] = [];

    for (const creativeId of creativeIds) {
      allImpressions.push(...trackingService.getImpressionsForAd(creativeId));
      allClicks.push(...trackingService.getClicksForAd(creativeId));
    }

    const validClicks = allClicks.filter((cl) => cl.valid);

    const impressions = allImpressions.length;
    const clicks = validClicks.length;
    const ctr = impressions > 0 ? Number((clicks / impressions).toFixed(4)) : 0;
    const totalSpend = c.totalSpend;
    const eCpm = impressions > 0 ? roundCurrency((totalSpend / impressions) * 1000) : 0;
    const averageAttentionScore =
      impressions > 0
        ? Number(
            (allImpressions.reduce((s, i) => s + i.attentionScore, 0) / impressions).toFixed(4)
          )
        : 0;

    const dailyBreakdown = buildDailyBreakdown(allImpressions, validClicks);

    return {
      campaignId: id,
      impressions,
      clicks,
      ctr,
      totalSpend,
      eCpm,
      averageAttentionScore,
      dailyBreakdown
    };
  }
}

// ── Daily breakdown helper ────────────────────────────────────────────────────

function buildDailyBreakdown(impressions: Impression[], clicks: Click[]): DailyAnalyticsEntry[] {
  const byDate = new Map<string, { imps: Impression[]; clicks: Click[] }>();

  for (const imp of impressions) {
    const date = imp.createdAt.slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, { imps: [], clicks: [] });
    byDate.get(date)!.imps.push(imp);
  }

  for (const click of clicks) {
    const date = click.timestamp.slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, { imps: [], clicks: [] });
    byDate.get(date)!.clicks.push(click);
  }

  const entries: DailyAnalyticsEntry[] = [];
  for (const [date, data] of byDate) {
    const impCount = data.imps.length;
    const clickCount = data.clicks.length;
    const avgAttn =
      impCount > 0
        ? Number((data.imps.reduce((s, i) => s + i.attentionScore, 0) / impCount).toFixed(4))
        : 0;
    entries.push({
      date,
      impressions: impCount,
      clicks: clickCount,
      spend: 0,   // per-day spend requires linking auction slots – omitted in this in-memory model
      averageAttentionScore: avgAttn
    });
  }

  entries.sort((a, b) => a.date.localeCompare(b.date));
  return entries;
}

// ── Module-level singleton ────────────────────────────────────────────────────

export const campaignStore = new CampaignStore();
