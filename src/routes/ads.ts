import { IncomingMessage, ServerResponse } from "node:http";
import { ContextualAdRequestSchema } from "../lib/validation";
import { selectContextualAds } from "../services/BiddingEngine";
import { withAuth } from "../middleware/auth";
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
 * POST /api/v1/ads/contextual
 *
 * Accepts user's current activity context (platform, activityContext, moodSignals)
 * and returns hyper-relevant, native ad formats.  No PII is required or used.
 * Requires a valid Quantmail Bearer JWT.
 */
export const handleContextualAds = withAuth(async (req: IncomingMessage, res: ServerResponse) => {
  const raw = await readJson(req);
  const parsed = ContextualAdRequestSchema.safeParse(raw);

  if (!parsed.success) {
    const errors = parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`);
    logger.warn({ errors }, "contextual ads validation failed");
    sendJson(res, 422, { error: "Validation failed", details: errors });
    return;
  }

  const { platform, activityContext, moodSignals, maxAds, adFormats } = parsed.data;

  logger.info({ platform, activityContext }, "contextual ads requested");

  const ads = selectContextualAds(
    { platform, activityContext, moodSignals: moodSignals ?? {} },
    maxAds,
    adFormats
  );

  sendJson(res, 200, {
    platform,
    activityContext,
    ads,
    meta: {
      totalCandidates: ads.length,
      piiUsed: false,
      engine: "quantads-contextual-v1"
    }
  });
});
