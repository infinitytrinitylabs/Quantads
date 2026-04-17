import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { simulateTwinAudience } from "./simulation/TwinSimulator";
import { BiddingEngine, OutcomeBidRequest } from "./bidding/BiddingEngine";
import { createOutcomeQuote, OutcomePaymentRequest } from "./payments/x402";
import { TwinSimulationRequest } from "./types";
import { handleContextualAds } from "./routes/ads";
import { handleAuctionBid, handleAuctionWinner } from "./routes/auctions";
import { handleCampaignAnalytics, handleRoiSummary } from "./routes/analytics";
import { handleOutcomeLookup, handleOutcomeReport } from "./routes/outcomes";
import { handleBciIngest, handleBciAggregated } from "./routes/bci";
import {
  handleCreateCampaign,
  handleListCampaigns,
  handleUpdateCampaign,
  handleDeleteCampaign,
  handleCampaignAdAnalytics
} from "./routes/campaigns";
import { logger } from "./lib/logger";
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

if (require.main === module) {
  const port = Number(process.env["PORT"] ?? "3000");
  app.listen(port, () => {
    logger.info({ port }, "Quantads API listening");
  });
}
