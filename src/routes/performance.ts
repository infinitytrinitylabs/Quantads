import { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { withAuth } from "../middleware/auth";
import { performanceStreakService } from "../services/PerformanceStreakService";
import { competitorMarketIntelService } from "../services/CompetitorMarketIntelService";

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

export const StreakRecordSchema = z.object({
  campaignId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  spend: z.number().nonnegative(),
  revenue: z.number().nonnegative()
});

export const MarketIntelSampleSchema = z.object({
  advertiserId: z.string().min(1),
  category: z.string().min(1).max(64),
  dailyBudget: z.number().nonnegative(),
  cpm: z.number().nonnegative().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

export const handleStreakRecord = withAuth(async (req, res) => {
  const parsed = StreakRecordSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    sendJson(res, 422, {
      error: "Validation failed",
      details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
    });
    return;
  }
  try {
    sendJson(res, 200, performanceStreakService.recordDay(parsed.data));
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : "record failed" });
  }
});

export const handleStreakGet = withAuth(async (req, res) => {
  const match = (req.url ?? "").match(/^\/api\/v1\/performance\/([^/]+)\/streak$/);
  if (!match) {
    sendJson(res, 404, { error: "Streak not found" });
    return;
  }
  const streak = performanceStreakService.getStreak(decodeURIComponent(match[1]));
  if (!streak) {
    sendJson(res, 404, { error: "No streak data for the specified campaign" });
    return;
  }
  sendJson(res, 200, streak);
});

export const handleMarketIntelIngest = withAuth(async (req, res) => {
  const parsed = MarketIntelSampleSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    sendJson(res, 422, {
      error: "Validation failed",
      details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
    });
    return;
  }
  competitorMarketIntelService.ingest(parsed.data);
  sendJson(res, 201, { accepted: true });
});

export const handleMarketIntelGet = withAuth(async (req, res, token) => {
  const match = (req.url ?? "").match(/^\/api\/v1\/market-intel\/([^/?]+)(\?.*)?$/);
  if (!match) {
    sendJson(res, 404, { error: "Category not found" });
    return;
  }
  const url = new URL(req.url ?? "/", "http://localhost");
  const requestingAdvertiserId =
    url.searchParams.get("advertiserId") ?? token.sub;

  const snapshot = competitorMarketIntelService.getSnapshot(
    decodeURIComponent(match[1]),
    requestingAdvertiserId
  );
  if (!snapshot) {
    sendJson(res, 404, {
      error: "Insufficient data to disclose — k-anonymity threshold not met"
    });
    return;
  }
  sendJson(res, 200, snapshot);
});
