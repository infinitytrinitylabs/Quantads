import { IncomingMessage, ServerResponse } from "node:http";
import { attentionStore, bciAttentionStore } from "../bci/AttentionStore";
import { detectFraud } from "../bci/FraudDetector";
import { withAuth } from "../middleware/auth";
import { BciAttentionIngestSchema, BciAttentionSignalSchema } from "../lib/validation";
import { BciAttentionSignal } from "../types";
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

const isBiometricPayload = (raw: unknown): boolean =>
  typeof raw === "object" && raw !== null && "sample" in (raw as Record<string, unknown>);

/**
 * POST /api/v1/bci/attention
 *
 * Dual-mode BCI ingestion endpoint. Dispatches based on body shape:
 *   • `{ sample: { eyeTrackingScore, heartRate, neuralActivity, recordedAt } }`
 *     → Biometric path. Runs real-time fraud detection before storing.
 *     Returns 200 with `{ userId, aggregated, fraud }`.
 *   • `{ userId, sessionId, platform, attentionScore, engagementScore, focusScore, ... }`
 *     → Signal path. Stores derived attention scores (no raw neural data).
 *     Returns 201 with the full ingestion record.
 *
 * Requires a valid Quantmail Bearer JWT.
 */
export const handleBciIngest = withAuth(async (req: IncomingMessage, res: ServerResponse, token) => {
  const raw = await readJson(req);

  if (isBiometricPayload(raw)) {
    const parsed = BciAttentionIngestSchema.safeParse(raw);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`);
      logger.warn({ errors }, "BCI biometric ingest validation failed");
      sendJson(res, 422, { error: "Validation failed", details: errors });
      return;
    }

    const { sample } = parsed.data;

    // Run fraud detection against the current window + new sample
    const existing = attentionStore.getWindow(token.sub);
    const windowSamples = existing ? [...existing.samples, sample] : [sample];
    const fraud = detectFraud(windowSamples);

    if (fraud.verdict === "fraud") {
      logger.warn(
        { userId: token.sub, fraudScore: fraud.fraudScore, flags: fraud.flags },
        "BCI fraud detected"
      );
      sendJson(res, 403, {
        error: "Biometric fraud detected",
        fraudScore: fraud.fraudScore,
        flags: fraud.flags
      });
      return;
    }

    const window = attentionStore.ingest(token.sub, sample);

    logger.info(
      { userId: token.sub, attentionScore: window.aggregated.attentionScore },
      "BCI sample ingested"
    );

    sendJson(res, 200, {
      userId: token.sub,
      aggregated: window.aggregated,
      fraud: {
        verdict: fraud.verdict,
        fraudScore: fraud.fraudScore,
        flags: fraud.flags
      }
    });
    return;
  }

  // Signal-based ingestion
  const parsed = BciAttentionSignalSchema.safeParse(raw);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`);
    logger.warn({ errors }, "BCI attention signal validation failed");
    sendJson(res, 422, { error: "Validation failed", details: errors });
    return;
  }

  // Use validated data directly from Zod - no unsafe cast needed
  const signal = parsed.data;
  logger.info(
    { sessionId: signal.sessionId, platform: signal.platform },
    "BCI attention signal ingested"
  );

  const record = bciAttentionStore.ingest(signal);
  sendJson(res, 201, record);
});

/**
 * GET /api/v1/bci/attention/:userId/aggregated
 *
 * Returns aggregated BCI metrics for the given user. Prefers biometric-window
 * data (from the real-time attention pipeline) and falls back to the
 * signal-based aggregate when no biometric data is present.
 *
 * Requires a valid Quantmail Bearer JWT.
 */
export const handleBciAggregated = withAuth(async (req: IncomingMessage, res: ServerResponse) => {
  const match = req.url?.match(/^\/api\/v1\/bci\/attention\/([^/]+)\/aggregated$/);

  if (!match) {
    sendJson(res, 404, { error: "BCI route not found" });
    return;
  }

  const userId = decodeURIComponent(match[1]!);

  // Basic sanity check: userId must be a non-empty string of printable characters
  // with a reasonable length limit to prevent resource exhaustion.
  if (userId.length === 0 || userId.length > 256 || !/^[\w\-@.]+$/.test(userId)) {
    sendJson(res, 400, { error: "Invalid userId format" });
    return;
  }

  // Prefer biometric window when available
  const biometric = attentionStore.getAggregated(userId);
  if (biometric) {
    sendJson(res, 200, { userId, aggregated: biometric });
    return;
  }

  // Fallback: signal-based aggregate
  const signalMetrics = bciAttentionStore.getAggregated(userId);
  if (signalMetrics) {
    sendJson(res, 200, signalMetrics);
    return;
  }

  sendJson(res, 404, { error: "No BCI data found for the specified user" });
});
