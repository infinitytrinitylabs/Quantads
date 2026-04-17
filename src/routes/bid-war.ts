import { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { getBidWarRoomHtml } from "../exchange/BidWarRoomPage";
import { withAuth } from "../middleware/auth";
import { bidWarAnalyticsService } from "../services/BidWarAnalyticsService";

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

const sendHtml = (res: ServerResponse, status: number, html: string): void => {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
};

const readJson = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
};

const parseUrl = (rawUrl: string | undefined): URL => new URL(rawUrl ?? "/", "http://127.0.0.1");

const parseBidWarRoute = (
  url: string | undefined
): { advertiserId: string; view: "snapshot" | "sniper" | "strategy" | "room" } | null => {
  if (!url) {
    return null;
  }

  const roomMatch = url.match(/^\/advertisers\/([^/]+)\/bid-war-room(?:\?.*)?$/);
  if (roomMatch) {
    return {
      advertiserId: decodeURIComponent(roomMatch[1] ?? ""),
      view: "room"
    };
  }

  const strategyMatch = url.match(/^\/api\/v1\/bid-war\/advertisers\/([^/]+)\/strategy\/optimize(?:\?.*)?$/);
  if (strategyMatch) {
    return {
      advertiserId: decodeURIComponent(strategyMatch[1] ?? ""),
      view: "strategy"
    };
  }

  const sniperMatch = url.match(/^\/api\/v1\/bid-war\/advertisers\/([^/]+)\/sniper-mode(?:\?.*)?$/);
  if (sniperMatch) {
    return {
      advertiserId: decodeURIComponent(sniperMatch[1] ?? ""),
      view: "sniper"
    };
  }

  const snapshotMatch = url.match(/^\/api\/v1\/bid-war\/advertisers\/([^/?]+)(?:\?.*)?$/);
  if (snapshotMatch) {
    return {
      advertiserId: decodeURIComponent(snapshotMatch[1] ?? ""),
      view: "snapshot"
    };
  }

  return null;
};

const AudienceSchema = z.object({
  verifiedLtv: z.number().positive(),
  intentScore: z.number().min(0).max(1),
  conversionRate: z.number().min(0).max(1),
  recencyMultiplier: z.number().positive().optional(),
  attentionScore: z.number().min(0).max(1).optional()
});

const BidWarQuerySchema = z.object({
  granularity: z.enum(["minute", "hour"]).optional().default("minute"),
  candleLimit: z.coerce.number().int().min(1).max(120).optional().default(48),
  replayLimit: z.coerce.number().int().min(1).max(200).optional().default(80)
});

const SniperModeSchema = z.object({
  auctionId: z.string().min(1).optional(),
  baseOutcomePrice: z.number().positive(),
  audience: AudienceSchema,
  marketPressure: z.number().positive().optional(),
  floorPrice: z.number().positive().optional(),
  maxPrice: z.number().positive().optional(),
  riskTolerance: z.number().min(0).max(1).optional(),
  maxIncrement: z.number().positive().optional(),
  aggression: z.number().min(0).max(1).optional(),
  objective: z.enum(["balanced", "scale-wins", "defend-margin", "sniper"]).optional()
});

const StrategyOptimizeSchema = z.object({
  auctionId: z.string().min(1).optional(),
  baseOutcomePrice: z.number().positive(),
  audience: AudienceSchema,
  marketPressure: z.number().positive().optional(),
  floorPrice: z.number().positive().optional(),
  maxPrice: z.number().positive().optional(),
  riskTolerance: z.number().min(0).max(1).optional(),
  objective: z.enum(["balanced", "scale-wins", "defend-margin", "sniper"]).optional(),
  competitionIndex: z.number().min(0).max(1.5).optional(),
  sniperMode: z.boolean().optional(),
  marginGuardrail: z.number().min(0.05).max(0.9).optional()
});

const sendValidationFailure = (res: ServerResponse, error: z.ZodError): void => {
  sendJson(res, 422, {
    error: "Validation failed",
    details: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
  });
};

export const handleBidWarSnapshot = withAuth(async (req: IncomingMessage, res: ServerResponse, token) => {
  const route = parseBidWarRoute(req.url);
  if (!route || route.view !== "snapshot") {
    sendJson(res, 404, { error: "Bid war route not found" });
    return;
  }

  if (route.advertiserId !== token.sub) {
    sendJson(res, 403, { error: "Advertiser scope does not match authenticated subject" });
    return;
  }

  const parsed = BidWarQuerySchema.safeParse(Object.fromEntries(parseUrl(req.url).searchParams.entries()));
  if (!parsed.success) {
    sendValidationFailure(res, parsed.error);
    return;
  }

  sendJson(
    res,
    200,
    bidWarAnalyticsService.getDashboard(route.advertiserId, {
      granularity: parsed.data.granularity,
      candleLimit: parsed.data.candleLimit,
      replayLimit: parsed.data.replayLimit
    })
  );
});

export const handleBidWarSniperMode = withAuth(async (req: IncomingMessage, res: ServerResponse, token) => {
  const route = parseBidWarRoute(req.url);
  if (!route || route.view !== "sniper") {
    sendJson(res, 404, { error: "Bid war sniper route not found" });
    return;
  }

  if (route.advertiserId !== token.sub) {
    sendJson(res, 403, { error: "Advertiser scope does not match authenticated subject" });
    return;
  }

  const parsed = SniperModeSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    sendValidationFailure(res, parsed.error);
    return;
  }

  sendJson(res, 200, bidWarAnalyticsService.evaluateSniperMode(route.advertiserId, parsed.data));
});

export const handleBidWarStrategyOptimize = withAuth(async (req: IncomingMessage, res: ServerResponse, token) => {
  const route = parseBidWarRoute(req.url);
  if (!route || route.view !== "strategy") {
    sendJson(res, 404, { error: "Bid war strategy route not found" });
    return;
  }

  if (route.advertiserId !== token.sub) {
    sendJson(res, 403, { error: "Advertiser scope does not match authenticated subject" });
    return;
  }

  const parsed = StrategyOptimizeSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    sendValidationFailure(res, parsed.error);
    return;
  }

  sendJson(res, 200, bidWarAnalyticsService.optimizeStrategy(route.advertiserId, parsed.data));
});

export const handleBidWarRoom = withAuth(async (req: IncomingMessage, res: ServerResponse, token) => {
  const route = parseBidWarRoute(req.url);
  if (!route || route.view !== "room") {
    sendJson(res, 404, { error: "Bid war room route not found" });
    return;
  }

  if (route.advertiserId !== token.sub) {
    sendJson(res, 403, { error: "Advertiser scope does not match authenticated subject" });
    return;
  }

  const rawAuthorization = req.headers.authorization?.slice(7) ?? "";
  sendHtml(
    res,
    200,
    getBidWarRoomHtml({
      advertiserId: route.advertiserId,
      token: rawAuthorization
    })
  );
});
