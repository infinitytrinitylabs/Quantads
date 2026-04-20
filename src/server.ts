import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { simulateTwinAudience } from "./simulation/TwinSimulator";
import { BiddingEngine, OutcomeBidRequest } from "./bidding/BiddingEngine";
import { createOutcomeQuote, OutcomePaymentRequest } from "./payments/x402";
import { TwinSimulationRequest } from "./types";
import { handleContextualAds } from "./routes/ads";
import { handleSmartAdEmotion, handleSmartAdRender, handleSmartAdSelect } from "./routes/smartads";
import { handleAuctionBid, handleAuctionWinner } from "./routes/auctions";
import { handleCampaignAnalytics, handleRoiSummary } from "./routes/analytics";
import {
  handleExchangeAnalytics,
  handleExchangeAuctionSnapshot,
  handleExchangeBid,
  handleExchangeDashboard,
  handleExchangeFraudModel,
  handleHfbExchangeBid,
  handleHfbExchangeStats
} from "./routes/exchange";
import { handleOutcomeLookup, handleOutcomeReport } from "./routes/outcomes";
import { handleBciIngest, handleBciAggregated } from "./routes/bci";
import { handleDashboardStream } from "./routes/dashboard";
import {
  handleSmartAdPreview,
  handleAbImpression,
  handleAbClick,
  handleAbMetrics
} from "./routes/smart-ads";
import {
  handleTickerPublish,
  handleTickerRecent,
  handleTickerOptOut,
  handleTickerStream
} from "./routes/ticker";
import {
  handleSplitTestCreate,
  handleSplitTestGet,
  handleSplitTestActivity,
  handleSplitTestFinalize
} from "./routes/split-tests";
import { handleHeatmapIngest, handleHeatmapGet } from "./routes/heatmaps";
import {
  handleStreakRecord,
  handleStreakGet,
  handleMarketIntelIngest,
  handleMarketIntelGet
} from "./routes/performance";
import {
  handleAutopilotCreate,
  handleAutopilotMode,
  handleAutopilotEvaluate,
  handleAutopilotGet,
  handleAutopilotAudit
} from "./routes/autopilot";
import {
  handleBidWarRoom,
  handleBidWarSnapshot,
  handleBidWarSniperMode,
  handleBidWarStrategyOptimize
} from "./routes/bid-war";
import {
  handleCreateCampaign,
  handleListCampaigns,
  handleUpdateCampaign,
  handleDeleteCampaign,
  handleCampaignAdAnalytics
} from "./routes/campaigns";
import { logger } from "./lib/logger";
import { realtimeAnalyticsHub } from "./exchange/RealtimeAnalyticsHub";
import {
  OutcomeBidRequestSchema,
  OutcomePaymentRequestSchema,
  TwinSimulationRequestSchema
} from "./lib/validation";

const biddingEngine = new BiddingEngine();

const readJson = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }

  if (!chunks.length) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

export const app = createServer(async (request, response) => {
  const start = Date.now();

  // Wraps sendJson to include X-Response-Time measured from the start of the request.
  // Used only for direct server.ts responses; route handlers emit their own responses.
  const sendJsonTimed = (statusCode: number, body: unknown): void => {
    response.writeHead(statusCode, {
      "content-type": "application/json; charset=utf-8",
      "X-Response-Time": `${Date.now() - start}ms`
    });
    response.end(JSON.stringify(body));
  };

  try {
    if (request.method === "GET" && request.url === "/health") {
      sendJsonTimed(200, { status: "ok", service: "quantads" });
      return;
    }

    // Contextual ad serving – Quantmail JWT required (biometric SSO)
    if (request.method === "POST" && request.url === "/api/v1/ads/contextual") {
      await handleContextualAds(request, response);
      return;
    }

    // Smart Ads – OLD handlers (emotion/select/render) – using smartads module
    // These handlers are deprecated in favor of the V2 handlers below
    if (request.method === "POST" && request.url === "/api/v1/smart-ads/emotion") {
      await handleSmartAdEmotion(request, response);
      return;
    }

    if (request.method === "POST" && request.url === "/api/v1/smart-ads/select") {
      await handleSmartAdSelect(request, response);
      return;
    }

    if (request.method === "POST" && request.url === "/api/v1/smart-ads/render") {
      await handleSmartAdRender(request, response);
      return;
    }

    // ── Campaign Management ──────────────────────────────────────────────────

    // POST /api/v1/campaigns – create campaign
    if (request.method === "POST" && request.url === "/api/v1/campaigns") {
      await handleCreateCampaign(request, response);
      return;
    }

    // GET /api/v1/campaigns – list campaigns
    if (request.method === "GET" && request.url === "/api/v1/campaigns") {
      await handleListCampaigns(request, response);
      return;
    }

    // GET /api/v1/campaigns/:id/analytics
    if (request.method === "GET" && /^\/api\/v1\/campaigns\/[^/]+\/analytics$/.test(request.url ?? "")) {
      await handleCampaignAdAnalytics(request, response);
      return;
    }

    // PATCH /api/v1/campaigns/:id
    if (request.method === "PATCH" && /^\/api\/v1\/campaigns\/[^/]+$/.test(request.url ?? "")) {
      await handleUpdateCampaign(request, response);
      return;
    }

    // DELETE /api/v1/campaigns/:id
    if (request.method === "DELETE" && /^\/api\/v1\/campaigns\/[^/]+$/.test(request.url ?? "")) {
      await handleDeleteCampaign(request, response);
      return;
    }

    // Analytics – campaign performance (Quantmail JWT required)
    if (request.method === "GET" && request.url?.startsWith("/api/v1/analytics/campaigns")) {
      await handleCampaignAnalytics(request, response);
      return;
    }

    // Analytics – ROI summary (Quantmail JWT required)
    if (request.method === "GET" && request.url === "/api/v1/analytics/roi") {
      await handleRoiSummary(request, response);
      return;
    }

    if (
      request.method === "POST" &&
      /^\/api\/v1\/exchange\/auctions\/[^/]+\/slots\/[^/]+\/bid(?:\?.*)?$/.test(request.url ?? "")
    ) {
      await handleExchangeBid(request, response);
      return;
    }

    if (
      request.method === "GET" &&
      /^\/api\/v1\/exchange\/auctions\/[^/]+\/slots\/[^/]+(?:\?.*)?$/.test(request.url ?? "")
    ) {
      await handleExchangeAuctionSnapshot(request, response);
      return;
    }

    if (
      request.method === "GET" &&
      /^\/api\/v1\/exchange\/analytics\/advertisers\/[^/]+(?:\/events)?(?:\?.*)?$/.test(request.url ?? "")
    ) {
      await handleExchangeAnalytics(request, response);
      return;
    }

    if (request.method === "GET" && request.url === "/api/v1/exchange/fraud/model") {
      await handleExchangeFraudModel(request, response);
      return;
    }

    if (
      request.method === "GET" &&
      /^\/advertisers\/[^/]+\/exchange-dashboard(?:\?.*)?$/.test(request.url ?? "")
    ) {
      await handleExchangeDashboard(request, response);
      return;
    }

    if (
      request.method === "GET" &&
      /^\/advertisers\/[^/]+\/bid-war-room(?:\?.*)?$/.test(request.url ?? "")
    ) {
      await handleBidWarRoom(request, response);
      return;
    }

    if (request.method === "POST" && /^\/api\/v1\/auctions\/[^/]+\/bid$/.test(request.url ?? "")) {
      await handleAuctionBid(request, response);
      return;
    }

    if (request.method === "GET" && /^\/api\/v1\/auctions\/[^/]+\/winner$/.test(request.url ?? "")) {
      await handleAuctionWinner(request, response);
      return;
    }

    if (request.method === "POST" && request.url === "/api/v1/outcomes/report") {
      await handleOutcomeReport(request, response);
      return;
    }

    if (request.method === "GET" && /^\/api\/v1\/outcomes\/[^/]+$/.test(request.url ?? "")) {
      await handleOutcomeLookup(request, response);
      return;
    }

    // BCI attention-tracking ingestion (Quantmail JWT required)
    if (request.method === "POST" && request.url === "/api/v1/bci/attention") {
      await handleBciIngest(request, response);
      return;
    }

    // BCI aggregated metrics lookup (Quantmail JWT required)
    if (
      request.method === "GET" &&
      /^\/api\/v1\/bci\/attention\/[^/]+\/aggregated$/.test(request.url ?? "")
    ) {
      await handleBciAggregated(request, response);
      return;
    }

    // HFB exchange – high-frequency in-process ring-buffer bid submission
    if (request.method === "POST" && request.url === "/api/v1/exchange/bid") {
      await handleHfbExchangeBid(request, response);
      return;
    }

    // HFB exchange – throughput / buffer statistics
    if (request.method === "GET" && request.url === "/api/v1/exchange/stats") {
      await handleHfbExchangeStats(request, response);
      return;
    }

    // Real-time advertiser analytics dashboard (SSE)
    if (request.method === "GET" && request.url === "/api/v1/dashboard/stream") {
      await handleDashboardStream(request, response);
      return;
    }

    // ── Smart Ads (V2 API) ────────────────────────────────────────────────────

    // GET /api/v1/smart-ads/preview — advertiser preview page
    if (request.method === "GET" && (request.url === "/api/v1/smart-ads/preview" || request.url?.startsWith("/api/v1/smart-ads/preview?"))) {
      await handleSmartAdPreview(request, response);
      return;
    }

    // POST /api/v1/smart-ads/ab/impression
    if (request.method === "POST" && request.url === "/api/v1/smart-ads/ab/impression") {
      await handleAbImpression(request, response);
      return;
    }

    // POST /api/v1/smart-ads/ab/click
    if (request.method === "POST" && request.url === "/api/v1/smart-ads/ab/click") {
      await handleAbClick(request, response);
      return;
    }

    // GET /api/v1/smart-ads/ab/metrics
    if (request.method === "GET" && (request.url === "/api/v1/smart-ads/ab/metrics" || request.url?.startsWith("/api/v1/smart-ads/ab/metrics?"))) {
      await handleAbMetrics(request, response);
      return;
    }

    // ── Auction Ticker (transparency) ────────────────────────────────────────
    if (request.method === "POST" && request.url === "/api/v1/ticker/publish") {
      await handleTickerPublish(request, response);
      return;
    }
    if (request.method === "GET" && request.url?.startsWith("/api/v1/ticker/recent")) {
      await handleTickerRecent(request, response);
      return;
    }
    if (request.method === "POST" && request.url === "/api/v1/ticker/opt-out") {
      await handleTickerOptOut(request, response);
      return;
    }
    if (request.method === "GET" && request.url === "/api/v1/ticker/stream") {
      await handleTickerStream(request, response);
      return;
    }

    // ── Audience Split Tests (standard A/B) ──────────────────────────────────
    if (request.method === "POST" && request.url === "/api/v1/split-tests") {
      await handleSplitTestCreate(request, response);
      return;
    }
    if (
      request.method === "POST" &&
      /^\/api\/v1\/split-tests\/[^/]+\/activity$/.test(request.url ?? "")
    ) {
      await handleSplitTestActivity(request, response);
      return;
    }
    if (
      request.method === "POST" &&
      /^\/api\/v1\/split-tests\/[^/]+\/finalize$/.test(request.url ?? "")
    ) {
      await handleSplitTestFinalize(request, response);
      return;
    }
    if (request.method === "GET" && /^\/api\/v1\/split-tests\/[^/]+$/.test(request.url ?? "")) {
      await handleSplitTestGet(request, response);
      return;
    }

    // ── Attention Heatmaps (privacy-preserving) ──────────────────────────────
    if (request.method === "POST" && request.url === "/api/v1/heatmaps/samples") {
      await handleHeatmapIngest(request, response);
      return;
    }
    if (
      request.method === "GET" &&
      /^\/api\/v1\/heatmaps\/[^/]+\/[^/?]+(\?.*)?$/.test(request.url ?? "")
    ) {
      await handleHeatmapGet(request, response);
      return;
    }

    // ── Performance Streak (factual reporting) ───────────────────────────────
    if (request.method === "POST" && request.url === "/api/v1/performance/record") {
      await handleStreakRecord(request, response);
      return;
    }
    if (
      request.method === "GET" &&
      /^\/api\/v1\/performance\/[^/]+\/streak$/.test(request.url ?? "")
    ) {
      await handleStreakGet(request, response);
      return;
    }

    // ── Competitor Market Intelligence (pull-only, k-anonymous) ──────────────
    if (request.method === "POST" && request.url === "/api/v1/market-intel/samples") {
      await handleMarketIntelIngest(request, response);
      return;
    }
    if (
      request.method === "GET" &&
      /^\/api\/v1\/market-intel\/[^/?]+(\?.*)?$/.test(request.url ?? "")
    ) {
      await handleMarketIntelGet(request, response);
      return;
    }

    // ── Bid Autopilot (opt-in, capped, audited) ──────────────────────────────
    if (request.method === "POST" && request.url === "/api/v1/autopilot/policies") {
      await handleAutopilotCreate(request, response);
      return;
    }
    if (
      request.method === "POST" &&
      /^\/api\/v1\/autopilot\/policies\/[^/]+\/mode$/.test(request.url ?? "")
    ) {
      await handleAutopilotMode(request, response);
      return;
    }
    if (
      request.method === "POST" &&
      /^\/api\/v1\/autopilot\/policies\/[^/]+\/evaluate$/.test(request.url ?? "")
    ) {
      await handleAutopilotEvaluate(request, response);
      return;
    }
    if (
      request.method === "GET" &&
      /^\/api\/v1\/autopilot\/policies\/[^/]+\/audit$/.test(request.url ?? "")
    ) {
      await handleAutopilotAudit(request, response);
      return;
    }
    if (
      request.method === "GET" &&
      /^\/api\/v1\/autopilot\/policies\/[^/]+$/.test(request.url ?? "")
    ) {
      await handleAutopilotGet(request, response);
      return;
    }

    if (
      request.method === "GET" &&
      /^\/api\/v1\/bid-war\/advertisers\/[^/?]+(?:\?.*)?$/.test(request.url ?? "")
    ) {
      await handleBidWarSnapshot(request, response);
      return;
    }

    if (
      request.method === "POST" &&
      /^\/api\/v1\/bid-war\/advertisers\/[^/]+\/sniper-mode(?:\?.*)?$/.test(request.url ?? "")
    ) {
      await handleBidWarSniperMode(request, response);
      return;
    }

    if (
      request.method === "POST" &&
      /^\/api\/v1\/bid-war\/advertisers\/[^/]+\/strategy\/optimize(?:\?.*)?$/.test(request.url ?? "")
    ) {
      await handleBidWarStrategyOptimize(request, response);
      return;
    }

    // Geofence-based twin simulation
    if (request.method === "POST" && request.url === "/api/v1/twin-sim") {
      const raw = await readJson(request);
      const parsed = TwinSimulationRequestSchema.safeParse(raw);
      if (!parsed.success) {
        const errors = parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`);
        sendJsonTimed(422, { error: "Validation failed", details: errors });
        return;
      }
      sendJsonTimed(200, simulateTwinAudience(parsed.data as TwinSimulationRequest));
      return;
    }

    // Outcome-based bid calculation
    if (request.method === "POST" && request.url === "/api/v1/bid") {
      const raw = await readJson(request);
      const parsed = OutcomeBidRequestSchema.safeParse(raw);
      if (!parsed.success) {
        const errors = parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`);
        sendJsonTimed(422, { error: "Validation failed", details: errors });
        return;
      }
      const result = biddingEngine.calculateOutcomeBid(parsed.data as OutcomeBidRequest);
      sendJsonTimed(200, result);
      return;
    }

    // x402 payment quote
    if (request.method === "POST" && request.url === "/api/v1/payments/x402/quote") {
      const raw = await readJson(request);
      const parsed = OutcomePaymentRequestSchema.safeParse(raw);
      if (!parsed.success) {
        const errors = parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`);
        sendJsonTimed(422, { error: "Validation failed", details: errors });
        return;
      }
      sendJsonTimed(200, createOutcomeQuote(parsed.data as OutcomePaymentRequest));
      return;
    }

    sendJsonTimed(404, { error: "Not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    logger.error({ err: message, method: request.method, url: request.url }, "request error");
    sendJsonTimed(400, { error: message });
  } finally {
    const durationMs = Date.now() - start;
    logger.info(
      { method: request.method, url: request.url, durationMs },
      "request"
    );
  }
});

realtimeAnalyticsHub.attach(app);

if (require.main === module) {
  const port = Number(process.env["PORT"] ?? "3000");
  app.listen(port, () => {
    logger.info({ port }, "Quantads API listening");
  });
}
