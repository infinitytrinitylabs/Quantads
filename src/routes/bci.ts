import { IncomingMessage, ServerResponse } from "node:http";
import { attentionStore } from "../bci/AttentionStore";
import { detectFraud } from "../bci/FraudDetector";
import { withAuth } from "../middleware/auth";
import { BciAttentionIngestSchema } from "../lib/validation";
import { logger } from "../lib/logger";

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

const readJson = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
};

/**
 * POST /api/v1/bci/attention
 *
 * Ingests a biometric attention sample for the authenticated user.
 * Runs real-time fraud detection before storing.
 *
 * Body: BciAttentionIngestRequest
 */
export const handleBciIngest = withAuth(async (req: IncomingMessage, res: ServerResponse, token) => {
  const raw = await readJson(req);
  const parsed = BciAttentionIngestSchema.safeParse(raw);

  if (!parsed.success) {
    const errors = parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`);
    logger.warn({ errors }, "BCI ingest validation failed");
    sendJson(res, 422, { error: "Validation failed", details: errors });
    return;
  }

  const { sample } = parsed.data;

  // Run fraud detection against the current window + new sample
  const existing = attentionStore.getWindow(token.sub);
  const windowSamples = existing ? [...existing.samples, sample] : [sample];
  const fraud = detectFraud(windowSamples);

  if (fraud.verdict === "fraud") {
    logger.warn({ userId: token.sub, fraudScore: fraud.fraudScore, flags: fraud.flags }, "BCI fraud detected");
    sendJson(res, 403, {
      error: "Biometric fraud detected",
      fraudScore: fraud.fraudScore,
      flags: fraud.flags
    });
    return;
  }

  const window = attentionStore.ingest(token.sub, sample);

  logger.info({ userId: token.sub, attentionScore: window.aggregated.attentionScore }, "BCI sample ingested");

  sendJson(res, 200, {
    userId: token.sub,
    aggregated: window.aggregated,
    fraud: {
      verdict: fraud.verdict,
      fraudScore: fraud.fraudScore,
      flags: fraud.flags
    }
  });
});

/**
 * GET /api/v1/bci/attention/:userId/aggregated
 *
 * Returns the current aggregated attention window for a user.
 * Requires JWT authentication.
 */
export const handleBciAggregated = withAuth(async (req: IncomingMessage, res: ServerResponse) => {
  const match = req.url?.match(/^\/api\/v1\/bci\/attention\/([^/]+)\/aggregated$/);

  if (!match) {
    sendJson(res, 404, { error: "Route not found" });
    return;
  }

  const userId = decodeURIComponent(match[1]!);

  // Basic sanity check: userId must be a non-empty string of printable characters
  // with a reasonable length limit to prevent resource exhaustion.
  if (userId.length === 0 || userId.length > 256 || !/^[\w\-@.]+$/.test(userId)) {
    sendJson(res, 400, { error: "Invalid userId format" });
    return;
  }

  const aggregated = attentionStore.getAggregated(userId);

  if (!aggregated) {
    sendJson(res, 404, { error: "No attention data found for user" });
    return;
  }

  sendJson(res, 200, { userId, aggregated });
});
