import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { simulateTwinAudience } from "./simulation/TwinSimulator";
import { BiddingEngine, OutcomeBidRequest } from "./bidding/BiddingEngine";
import { createOutcomeQuote, OutcomePaymentRequest } from "./payments/x402";
import { TwinSimulationRequest } from "./types";
import { handleContextualAds } from "./routes/ads";
import { handleCampaignAnalytics, handleRoiSummary } from "./routes/analytics";
import { logger } from "./lib/logger";
import {
  OutcomeBidRequestSchema,
  OutcomePaymentRequestSchema,
  TwinSimulationRequestSchema
} from "./lib/validation";

const biddingEngine = new BiddingEngine();

const sendJson = (response: ServerResponse, statusCode: number, body: unknown): void => {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
};

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

  try {
    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, { status: "ok", service: "quantads" });
      return;
    }

    // Contextual ad serving – Quantmail JWT required (biometric SSO)
    if (request.method === "POST" && request.url === "/api/v1/ads/contextual") {
      await handleContextualAds(request, response);
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

    // Geofence-based twin simulation
    if (request.method === "POST" && request.url === "/api/v1/twin-sim") {
      const raw = await readJson(request);
      const parsed = TwinSimulationRequestSchema.safeParse(raw);
      if (!parsed.success) {
        const errors = parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`);
        sendJson(response, 422, { error: "Validation failed", details: errors });
        return;
      }
      sendJson(response, 200, simulateTwinAudience(parsed.data as TwinSimulationRequest));
      return;
    }

    // Outcome-based bid calculation
    if (request.method === "POST" && request.url === "/api/v1/bid") {
      const raw = await readJson(request);
      const parsed = OutcomeBidRequestSchema.safeParse(raw);
      if (!parsed.success) {
        const errors = parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`);
        sendJson(response, 422, { error: "Validation failed", details: errors });
        return;
      }
      const result = biddingEngine.calculateOutcomeBid(parsed.data as OutcomeBidRequest);
      sendJson(response, 200, result);
      return;
    }

    // x402 payment quote
    if (request.method === "POST" && request.url === "/api/v1/payments/x402/quote") {
      const raw = await readJson(request);
      const parsed = OutcomePaymentRequestSchema.safeParse(raw);
      if (!parsed.success) {
        const errors = parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`);
        sendJson(response, 422, { error: "Validation failed", details: errors });
        return;
      }
      sendJson(response, 200, createOutcomeQuote(parsed.data as OutcomePaymentRequest));
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    logger.error({ err: message, method: request.method, url: request.url }, "request error");
    sendJson(response, 400, { error: message });
  } finally {
    logger.info(
      { method: request.method, url: request.url, durationMs: Date.now() - start },
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
