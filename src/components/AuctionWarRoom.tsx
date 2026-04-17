/**
 * AuctionWarRoom
 *
 * Server-side model for a three-panel "Auction War Room" dashboard.
 *
 * Panel layout
 * ────────────
 * LEFT    — ActiveCampaignPanel  : campaigns the advertiser is running
 * CENTER  — LiveAuctionFeedPanel : real-time auction events
 * RIGHT   — AnalyticsPanel       : win rate, avg CPM, spend velocity, ROI estimate
 *
 * Special modes
 * ─────────────
 * SniperMode   — auto-bid $0.01 above the current top competitor bid in the
 *                last 100 ms window before auction close.
 * DefenseMode  — automatically raise the advertiser's bid when a competitor
 *                raises theirs above a configurable threshold.
 *
 * Design notes
 * ────────────
 * - All automated bid changes made by Sniper / Defense modes are logged in
 *   an immutable `AutoBidAuditLog`.
 * - Both modes are opt-in and can be toggled independently per campaign.
 * - Sniper bids are capped at `maxSniperBid`; Defense raises are capped at
 *   `maxDefenseBid`.
 */

import { randomUUID } from "node:crypto";

// ── Constants ──────────────────────────────────────────────────────────────────

const SNIPER_INCREMENT          = 0.01;    // $0.01 above competitor
const SNIPER_WINDOW_MS          = 100;     // last 100 ms before auction close
const DEFAULT_DEFENSE_THRESHOLD = 0.05;   // raise if competitor increases by ≥5 %
const MAX_LIVE_EVENTS_IN_FEED   = 500;
const ANALYTICS_WINDOW_EVENTS   = 200;    // last N events used for metric computation

// ── Public types ───────────────────────────────────────────────────────────────

export type CampaignStatus = "active" | "paused" | "completed" | "draft";

export interface ActiveCampaign {
  campaignId: string;
  campaignName: string;
  advertiserId: string;
  status: CampaignStatus;
  currentBid: number;
  dailyBudget: number;
  todaySpend: number;
  sniperEnabled: boolean;
  defenseEnabled: boolean;
  maxSniperBid: number;
  maxDefenseBid: number;
  defenseThreshold: number;
  createdAt: string;
  updatedAt: string;
}

export interface RegisterCampaignInput {
  campaignId: string;
  campaignName: string;
  advertiserId: string;
  currentBid: number;
  dailyBudget: number;
  maxSniperBid?: number;
  maxDefenseBid?: number;
  defenseThreshold?: number;
}

export type AuctionEventType =
  | "bid_placed"
  | "bid_won"
  | "bid_lost"
  | "sniper_bid"
  | "defense_bid"
  | "auction_closed"
  | "competitor_raised";

export interface AuctionEvent {
  eventId: string;
  type: AuctionEventType;
  campaignId: string;
  advertiserId: string;
  bidAmount: number;
  competitorBid?: number;
  auctionId: string;
  /** Milliseconds remaining in the auction at the time of this event. */
  msRemainingAtEvent: number;
  timestamp: string;
  meta?: Record<string, string | number | boolean>;
}

export interface AutoBidAuditEntry {
  auditId: string;
  mode: "sniper" | "defense";
  campaignId: string;
  auctionId: string;
  previousBid: number;
  newBid: number;
  competitorBid: number;
  rationale: string;
  at: string;
}

// ── Panel data types ──────────────────────────────────────────────────────────

export interface ActiveCampaignPanel {
  campaigns: ActiveCampaign[];
  totalDailyBudget: number;
  totalTodaySpend: number;
  activeCampaignCount: number;
  computedAt: string;
}

export interface LiveAuctionFeedPanel {
  events: AuctionEvent[];
  totalEvents: number;
  latestEventAt: string | null;
  computedAt: string;
}

export interface AnalyticsPanel {
  /** Fraction of auctions won in the analytics window [0, 1]. */
  winRate: number;
  /** Average cost per 1000 impressions (USD). */
  avgCpm: number;
  /** Spend per second averaged over the analytics window (USD/s). */
  spendVelocity: number;
  /** Estimated ROI based on win rate × assumed revenue-per-win / avg CPM. */
  roiEstimate: number;
  /** Number of sniper auto-bid actions in the analytics window. */
  sniperActivations: number;
  /** Number of defense auto-bid actions in the analytics window. */
  defenseActivations: number;
  basedOnEventCount: number;
  computedAt: string;
}

export interface WarRoomSnapshot {
  snapshotId: string;
  leftPanel: ActiveCampaignPanel;
  centerPanel: LiveAuctionFeedPanel;
  rightPanel: AnalyticsPanel;
  autoAuditLog: AutoBidAuditEntry[];
  timestamp: string;
}

// ── AuctionWarRoomEngine ──────────────────────────────────────────────────────

export class AuctionWarRoomEngine {
  private readonly campaigns      = new Map<string, ActiveCampaign>();
  private readonly liveEvents:    AuctionEvent[] = [];
  private readonly autoBidAudit:  AutoBidAuditEntry[] = [];

  /** Track the latest bid per (campaignId, auctionId) for defense comparison. */
  private readonly latestCompetitorBid = new Map<string, number>();

  // ── Campaign management ───────────────────────────────────────────────────────

  registerCampaign(input: RegisterCampaignInput): ActiveCampaign {
    if (input.currentBid <= 0) throw new Error("currentBid must be positive");
    if (input.dailyBudget <= 0) throw new Error("dailyBudget must be positive");

    const campaign: ActiveCampaign = {
      campaignId:       input.campaignId,
      campaignName:     input.campaignName,
      advertiserId:     input.advertiserId,
      status:           "active",
      currentBid:       input.currentBid,
      dailyBudget:      input.dailyBudget,
      todaySpend:       0,
      sniperEnabled:    false,
      defenseEnabled:   false,
      maxSniperBid:     input.maxSniperBid  ?? input.currentBid * 2,
      maxDefenseBid:    input.maxDefenseBid ?? input.currentBid * 2,
      defenseThreshold: input.defenseThreshold ?? DEFAULT_DEFENSE_THRESHOLD,
      createdAt:        new Date().toISOString(),
      updatedAt:        new Date().toISOString()
    };

    this.campaigns.set(campaign.campaignId, campaign);
    return { ...campaign };
  }

  updateCampaignStatus(campaignId: string, status: CampaignStatus): ActiveCampaign {
    const c = this.requireCampaign(campaignId);
    c.status    = status;
    c.updatedAt = new Date().toISOString();
    return { ...c };
  }

  updateBid(campaignId: string, newBid: number): ActiveCampaign {
    const c = this.requireCampaign(campaignId);
    if (newBid <= 0) throw new Error("newBid must be positive");
    c.currentBid = newBid;
    c.updatedAt  = new Date().toISOString();
    return { ...c };
  }

  recordSpend(campaignId: string, amount: number): void {
    const c = this.requireCampaign(campaignId);
    c.todaySpend = Number((c.todaySpend + amount).toFixed(4));
    c.updatedAt  = new Date().toISOString();
  }

  resetDailySpend(campaignId: string): void {
    const c = this.requireCampaign(campaignId);
    c.todaySpend = 0;
    c.updatedAt  = new Date().toISOString();
  }

  getCampaign(campaignId: string): ActiveCampaign | null {
    const c = this.campaigns.get(campaignId);
    return c ? { ...c } : null;
  }

  // ── Mode toggles ──────────────────────────────────────────────────────────────

  enableSniperMode(campaignId: string, maxSniperBid?: number): ActiveCampaign {
    const c = this.requireCampaign(campaignId);
    c.sniperEnabled = true;
    if (maxSniperBid != null && maxSniperBid > 0) c.maxSniperBid = maxSniperBid;
    c.updatedAt = new Date().toISOString();
    return { ...c };
  }

  disableSniperMode(campaignId: string): ActiveCampaign {
    const c = this.requireCampaign(campaignId);
    c.sniperEnabled = false;
    c.updatedAt     = new Date().toISOString();
    return { ...c };
  }

  enableDefenseMode(campaignId: string, maxDefenseBid?: number, threshold?: number): ActiveCampaign {
    const c = this.requireCampaign(campaignId);
    c.defenseEnabled = true;
    if (maxDefenseBid != null && maxDefenseBid > 0) c.maxDefenseBid = maxDefenseBid;
    if (threshold != null && threshold > 0) c.defenseThreshold = threshold;
    c.updatedAt = new Date().toISOString();
    return { ...c };
  }

  disableDefenseMode(campaignId: string): ActiveCampaign {
    const c = this.requireCampaign(campaignId);
    c.defenseEnabled = false;
    c.updatedAt      = new Date().toISOString();
    return { ...c };
  }

  // ── Auction event ingestion ───────────────────────────────────────────────────

  /**
   * Record an auction event.  Automatically applies Sniper and Defense mode
   * logic where applicable.
   *
   * Returns the (possibly augmented) event plus any auto-bid event generated
   * by Sniper or Defense mode.
   */
  ingestAuctionEvent(event: AuctionEvent): {
    event: AuctionEvent;
    autoBidEvent: AuctionEvent | null;
  } {
    const stored: AuctionEvent = event.eventId
      ? event
      : { ...event, eventId: randomUUID() };

    this.liveEvents.push(stored);
    if (this.liveEvents.length > MAX_LIVE_EVENTS_IN_FEED) this.liveEvents.shift();

    let autoBidEvent: AuctionEvent | null = null;

    const campaign = this.campaigns.get(stored.campaignId);
    if (!campaign || campaign.status !== "active") {
      return { event: stored, autoBidEvent };
    }

    // ── Sniper mode ────────────────────────────────────────────────────────────
    if (
      campaign.sniperEnabled &&
      stored.competitorBid != null &&
      stored.msRemainingAtEvent <= SNIPER_WINDOW_MS
    ) {
      const sniperBid = Math.min(
        stored.competitorBid + SNIPER_INCREMENT,
        campaign.maxSniperBid
      );

      if (sniperBid > campaign.currentBid) {
        const prevBid = campaign.currentBid;
        campaign.currentBid = Number(sniperBid.toFixed(4));
        campaign.updatedAt  = new Date().toISOString();

        const auditEntry: AutoBidAuditEntry = {
          auditId:       randomUUID(),
          mode:          "sniper",
          campaignId:    campaign.campaignId,
          auctionId:     stored.auctionId,
          previousBid:   prevBid,
          newBid:        campaign.currentBid,
          competitorBid: stored.competitorBid,
          rationale:
            `Sniper mode: raised bid from ${prevBid.toFixed(4)} to ` +
            `${campaign.currentBid.toFixed(4)} ($${SNIPER_INCREMENT} above ` +
            `competitor ${stored.competitorBid.toFixed(4)}) with ` +
            `${stored.msRemainingAtEvent}ms remaining.`,
          at: new Date().toISOString()
        };
        this.autoBidAudit.push(auditEntry);

        autoBidEvent = this.buildAutoBidEvent(
          "sniper_bid", campaign, stored.auctionId, stored.competitorBid
        );
        this.liveEvents.push(autoBidEvent);
      }
    }

    // ── Defense mode ───────────────────────────────────────────────────────────
    if (campaign.defenseEnabled && stored.competitorBid != null) {
      const compKey = `${campaign.campaignId}::${stored.auctionId}`;
      const prevCompetitorBid = this.latestCompetitorBid.get(compKey) ?? 0;
      const competitorBid     = stored.competitorBid;
      this.latestCompetitorBid.set(compKey, competitorBid);

      const raiseFraction =
        prevCompetitorBid > 0
          ? (competitorBid - prevCompetitorBid) / prevCompetitorBid
          : 0;

      if (raiseFraction >= campaign.defenseThreshold && competitorBid > campaign.currentBid) {
        const defenseBid = Math.min(competitorBid + SNIPER_INCREMENT, campaign.maxDefenseBid);

        if (defenseBid > campaign.currentBid) {
          const prevBid = campaign.currentBid;
          campaign.currentBid = Number(defenseBid.toFixed(4));
          campaign.updatedAt  = new Date().toISOString();

          const auditEntry: AutoBidAuditEntry = {
            auditId:       randomUUID(),
            mode:          "defense",
            campaignId:    campaign.campaignId,
            auctionId:     stored.auctionId,
            previousBid:   prevBid,
            newBid:        campaign.currentBid,
            competitorBid,
            rationale:
              `Defense mode: competitor raised by ${(raiseFraction * 100).toFixed(1)}% ` +
              `(from ${prevCompetitorBid.toFixed(4)} to ${competitorBid.toFixed(4)}). ` +
              `Counter-raised own bid from ${prevBid.toFixed(4)} to ${campaign.currentBid.toFixed(4)}.`,
            at: new Date().toISOString()
          };
          this.autoBidAudit.push(auditEntry);

          if (!autoBidEvent) {
            autoBidEvent = this.buildAutoBidEvent(
              "defense_bid", campaign, stored.auctionId, competitorBid
            );
            this.liveEvents.push(autoBidEvent);
          }
        }
      }
    }

    return { event: stored, autoBidEvent };
  }

  // ── Dashboard snapshot ────────────────────────────────────────────────────────

  /**
   * Produce a full WarRoomSnapshot for rendering the three-panel dashboard.
   */
  getSnapshot(): WarRoomSnapshot {
    return {
      snapshotId:   randomUUID(),
      leftPanel:    this.buildLeftPanel(),
      centerPanel:  this.buildCenterPanel(),
      rightPanel:   this.buildRightPanel(),
      autoAuditLog: this.autoBidAudit.slice(),
      timestamp:    new Date().toISOString()
    };
  }

  /** Return the auto-bid audit log (immutable copy). */
  getAutoBidAudit(): AutoBidAuditEntry[] {
    return this.autoBidAudit.slice();
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  private requireCampaign(campaignId: string): ActiveCampaign {
    const c = this.campaigns.get(campaignId);
    if (!c) throw new Error(`campaign ${campaignId} not found in AuctionWarRoom`);
    return c;
  }

  private buildAutoBidEvent(
    type: AuctionEventType,
    campaign: ActiveCampaign,
    auctionId: string,
    competitorBid: number
  ): AuctionEvent {
    return {
      eventId:            randomUUID(),
      type,
      campaignId:         campaign.campaignId,
      advertiserId:       campaign.advertiserId,
      bidAmount:          campaign.currentBid,
      competitorBid,
      auctionId,
      msRemainingAtEvent: 0,
      timestamp:          new Date().toISOString()
    };
  }

  private buildLeftPanel(): ActiveCampaignPanel {
    const allCampaigns = [...this.campaigns.values()].map((c) => ({ ...c }));
    return {
      campaigns:           allCampaigns,
      totalDailyBudget:    allCampaigns.reduce((s, c) => s + c.dailyBudget, 0),
      totalTodaySpend:     allCampaigns.reduce((s, c) => s + c.todaySpend, 0),
      activeCampaignCount: allCampaigns.filter((c) => c.status === "active").length,
      computedAt:          new Date().toISOString()
    };
  }

  private buildCenterPanel(): LiveAuctionFeedPanel {
    const sorted = [...this.liveEvents].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    const latest = sorted[0]?.timestamp ?? null;

    return {
      events:         sorted,
      totalEvents:    this.liveEvents.length,
      latestEventAt:  latest,
      computedAt:     new Date().toISOString()
    };
  }

  private buildRightPanel(): AnalyticsPanel {
    const window  = this.liveEvents.slice(-ANALYTICS_WINDOW_EVENTS);
    const wins    = window.filter((e) => e.type === "bid_won").length;
    const losses  = window.filter((e) => e.type === "bid_lost").length;
    const total   = wins + losses;
    const winRate = total > 0 ? wins / total : 0;

    const wonEvents = window.filter((e) => e.type === "bid_won");
    const avgCpm    = wonEvents.length
      ? (wonEvents.reduce((s, e) => s + e.bidAmount, 0) / wonEvents.length) * 1000
      : 0;

    // Spend velocity: total spend in the window divided by elapsed seconds
    const allSpendEvents = window.filter((e) => ["bid_won", "sniper_bid", "defense_bid"].includes(e.type));
    let spendVelocity = 0;
    if (allSpendEvents.length >= 2) {
      const first   = new Date(allSpendEvents[0].timestamp).getTime();
      const last    = new Date(allSpendEvents[allSpendEvents.length - 1].timestamp).getTime();
      const elapsedS = (last - first) / 1_000;
      const totalSpend = allSpendEvents.reduce((s, e) => s + e.bidAmount, 0);
      spendVelocity = elapsedS > 0 ? totalSpend / elapsedS : 0;
    }

    // ROI estimate: assumed revenue-per-win is 3× CPM, divide by avg CPM
    const roiEstimate = avgCpm > 0 ? (avgCpm * 3) / avgCpm : 0;

    const sniperActivations  = window.filter((e) => e.type === "sniper_bid").length;
    const defenseActivations = window.filter((e) => e.type === "defense_bid").length;

    return {
      winRate:             Number(winRate.toFixed(4)),
      avgCpm:              Number(avgCpm.toFixed(4)),
      spendVelocity:       Number(spendVelocity.toFixed(6)),
      roiEstimate:         Number(roiEstimate.toFixed(4)),
      sniperActivations,
      defenseActivations,
      basedOnEventCount:   window.length,
      computedAt:          new Date().toISOString()
    };
  }
}

// ── Module-level singleton ─────────────────────────────────────────────────────

export const auctionWarRoomEngine = new AuctionWarRoomEngine();
