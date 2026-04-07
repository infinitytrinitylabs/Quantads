import { IncomingMessage, ServerResponse } from "node:http";
import { outcomeStore } from "../lib/outcome-store";
import { AnalyticsQuerySchema } from "../lib/validation";
import { withAuth } from "../middleware/auth";
import { logger } from "../lib/logger";

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

const parseQuery = (url: string): Record<string, string> => {
  const idx = url.indexOf("?");
  if (idx === -1) return {};
  return Object.fromEntries(new URLSearchParams(url.slice(idx + 1)));
};

// In-memory analytics store (replaced by Prisma queries in production)
interface MetricPoint {
  ts: string;
  impressions: number;
  clicks: number;
  outcomes: number;
  spend: number;
  revenue: number;
}

function generateMockMetrics(campaignId: string | undefined, from: Date, to: Date): MetricPoint[] {
  const points: MetricPoint[] = [];
  const cursor = new Date(from);
  while (cursor <= to) {
    const seed = (campaignId ?? "global").charCodeAt(0) + cursor.getDate();
    points.push({
      ts: cursor.toISOString(),
      impressions: 120 + (seed % 80),
      clicks: 8 + (seed % 12),
      outcomes: 1 + (seed % 3),
      spend: Number((50 + seed % 30).toFixed(2)),
      revenue: Number((180 + seed % 120).toFixed(2))
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return points;
}

function aggregateMetrics(points: MetricPoint[]) {
  const totals = points.reduce(
    (acc, p) => ({
      impressions: acc.impressions + p.impressions,
      clicks: acc.clicks + p.clicks,
      outcomes: acc.outcomes + p.outcomes,
      spend: acc.spend + p.spend,
      revenue: acc.revenue + p.revenue
    }),
    { impressions: 0, clicks: 0, outcomes: 0, spend: 0, revenue: 0 }
  );

  const ctr = totals.impressions > 0 ? totals.clicks / totals.impressions : 0;
  const roas = totals.spend > 0 ? totals.revenue / totals.spend : 0;
  const costPerOutcome = totals.outcomes > 0 ? totals.spend / totals.outcomes : 0;

  return {
    ...totals,
    spend: Number(totals.spend.toFixed(2)),
    revenue: Number(totals.revenue.toFixed(2)),
    ctr: Number(ctr.toFixed(4)),
    roas: Number(roas.toFixed(2)),
    costPerOutcome: Number(costPerOutcome.toFixed(2))
  };
}

/**
 * GET /api/v1/analytics/campaigns
 *
 * Returns real-time campaign performance metrics (ROI, CTR, ROAS, cost-per-outcome).
 * Query params: campaignId, from, to, granularity
 * Requires a valid Quantmail Bearer JWT.
 */
export const handleCampaignAnalytics = withAuth(
  async (req: IncomingMessage, res: ServerResponse) => {
    const qs = parseQuery(req.url ?? "");
    const parsed = AnalyticsQuerySchema.safeParse({
      campaignId: qs["campaignId"],
      from: qs["from"],
      to: qs["to"],
      granularity: qs["granularity"]
    });

    if (!parsed.success) {
      const errors = parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`);
      sendJson(res, 422, { error: "Validation failed", details: errors });
      return;
    }

    const { campaignId, from, to } = parsed.data;
    const fromDate = from ? new Date(from) : new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const toDate = to ? new Date(to) : new Date();

    logger.info({ campaignId, from: fromDate, to: toDate }, "analytics query");

    const series = generateMockMetrics(campaignId, fromDate, toDate);
    const summary = aggregateMetrics(series);
    const outcomeMetrics = outcomeStore.getPerformanceSummary(
      campaignId && campaignId !== "all" ? campaignId : undefined
    );

    sendJson(res, 200, {
      campaignId: campaignId ?? "all",
      period: { from: fromDate.toISOString(), to: toDate.toISOString() },
      summary: {
        ...summary,
        recordedOutcomes: outcomeMetrics.reportedOutcomes,
        billableOutcomes: outcomeMetrics.billableOutcomes,
        quotedSpend: outcomeMetrics.quotedSpend,
        settledSpend: outcomeMetrics.settledSpend,
        outcomeValueGenerated: outcomeMetrics.outcomeValueGenerated,
        outcomeBackedRoas: outcomeMetrics.outcomeBackedRoas,
        settlementCoverage: outcomeMetrics.settlementCoverage
      },
      outcomeMetrics,
      series
    });
  }
);

/**
 * GET /api/v1/analytics/roi
 *
 * Returns a high-level ROI summary across all campaigns for the authenticated advertiser.
 * Requires a valid Quantmail Bearer JWT.
 */
export const handleRoiSummary = withAuth(
  async (_req: IncomingMessage, res: ServerResponse, token) => {
    const fromDate = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const toDate = new Date();

    logger.info({ userId: token.sub }, "ROI summary requested");

    const campaignIds = ["cmp-travel-gear-001", "cmp-creative-tools-001", "cmp-chill-sounds-001"];
    const outcomeMetricsByCampaign = outcomeStore.getPerformanceSummaries(campaignIds);
    const campaigns = campaignIds.map((id) => {
      const series = generateMockMetrics(id, fromDate, toDate);
      const metrics = aggregateMetrics(series);
      return {
        campaignId: id,
        ...metrics,
        outcomeMetrics: outcomeMetricsByCampaign[id] ?? outcomeStore.getPerformanceSummary(id)
      };
    });

    const overallSpend = Number(campaigns.reduce((s, c) => s + c.spend, 0).toFixed(2));
    const overallRevenue = Number(campaigns.reduce((s, c) => s + c.revenue, 0).toFixed(2));
    const overallRoas = overallSpend > 0 ? Number((overallRevenue / overallSpend).toFixed(2)) : 0;
    const networkOutcomeMetrics = outcomeStore.getPerformanceSummary();

    sendJson(res, 200, {
      advertiserId: token.sub,
      period: { from: fromDate.toISOString(), to: toDate.toISOString() },
      overall: {
        spend: overallSpend,
        revenue: overallRevenue,
        roas: overallRoas,
        recordedOutcomes: networkOutcomeMetrics.reportedOutcomes,
        quotedSpend: networkOutcomeMetrics.quotedSpend,
        outcomeValueGenerated: networkOutcomeMetrics.outcomeValueGenerated,
        outcomeBackedRoas: networkOutcomeMetrics.outcomeBackedRoas
      },
      campaigns
    });
  }
);
