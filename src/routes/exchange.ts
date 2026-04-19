import { IncomingMessage, ServerResponse } from "node:http";
import { hfbExchange } from "../exchange/HFBExchange";
import { adExchangeEngine } from "../exchange/AdExchangeEngine";
import { getAdvertiserDashboardHtml } from "../exchange/AdvertiserDashboardPage";
import { exchangeAnalyticsStore } from "../exchange/ExchangeAnalyticsStore";
import {
  ExchangeAnalyticsQuerySchema,
  ExchangeBidRequestSchema,
  HFBBidSchema
} from "../lib/validation";
import { withAuth } from "../middleware/auth";
import { logger } from "../lib/logger";

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

const parseExchangeAuctionRoute = (url: string | undefined): { auctionId: string; slotId: string } | null => {
  if (!url) {
    return null;
  }

  const match = url.match(/^\/api\/v1\/exchange\/auctions\/([^/]+)\/slots\/([^/]+)(?:\/bid)?(?:\?.*)?$/);
  if (!match) {
    return null;
  }

  return {
    auctionId: decodeURIComponent(match[1] ?? ""),
    slotId: decodeURIComponent(match[2] ?? "")
  };
};

const parseAdvertiserRoute = (url: string | undefined): { advertiserId: string; view: "json" | "events" | "dashboard" } | null => {
  if (!url) {
    return null;
  }

  const dashboardMatch = url.match(/^\/advertisers\/([^/]+)\/exchange-dashboard(?:\?.*)?$/);
  if (dashboardMatch) {
    return {
      advertiserId: decodeURIComponent(dashboardMatch[1] ?? ""),
      view: "dashboard"
    };
  }

  const match = url.match(/^\/api\/v1\/exchange\/analytics\/advertisers\/([^/?]+)(?:\/(events))?(?:\?.*)?$/);
  if (!match) {
    return null;
  }

  return {
    advertiserId: decodeURIComponent(match[1] ?? ""),
    view: match[2] === "events" ? "events" : "json"
  };
};

/**
 * POST /api/v1/exchange/auctions/:auctionId/slots/:slotId/bid
 *
 * Route-scoped auction bid submission handled by the AdExchangeEngine.
 */
export const handleExchangeBid = withAuth(async (req: IncomingMessage, res: ServerResponse) => {
  const route = parseExchangeAuctionRoute(req.url);
  if (!route || !req.url?.includes("/bid")) {
    sendJson(res, 404, { error: "Exchange auction route not found" });
    return;
  }

  const raw = await readJson(req);
  const parsed = ExchangeBidRequestSchema.safeParse(raw);
  if (!parsed.success) {
    sendJson(res, 422, {
      error: "Validation failed",
      details: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    });
    return;
  }

  if (parsed.data.placement.auctionId !== route.auctionId || parsed.data.placement.slotId !== route.slotId) {
    sendJson(res, 422, { error: "Route auctionId/slotId must match placement payload" });
    return;
  }

  sendJson(res, 200, adExchangeEngine.submitBid(parsed.data));
});

export const handleExchangeAuctionSnapshot = withAuth(async (req: IncomingMessage, res: ServerResponse) => {
  const route = parseExchangeAuctionRoute(req.url);
  if (!route) {
    sendJson(res, 404, { error: "Exchange auction route not found" });
    return;
  }

  sendJson(res, 200, adExchangeEngine.getAuctionSnapshot(route.auctionId, route.slotId));
});

export const handleExchangeAnalytics = withAuth(async (req: IncomingMessage, res: ServerResponse, token) => {
  const route = parseAdvertiserRoute(req.url);
  if (!route || route.view === "dashboard") {
    sendJson(res, 404, { error: "Exchange analytics route not found" });
    return;
  }

  if (route.advertiserId !== token.sub) {
    sendJson(res, 403, { error: "Advertiser scope does not match authenticated subject" });
    return;
  }

  const parsedQuery = ExchangeAnalyticsQuerySchema.safeParse(Object.fromEntries(parseUrl(req.url).searchParams.entries()));
  if (!parsedQuery.success) {
    sendJson(res, 422, {
      error: "Validation failed",
      details: parsedQuery.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    });
    return;
  }

  if (route.view === "events") {
    sendJson(res, 200, exchangeAnalyticsStore.listRecentEvents(route.advertiserId, parsedQuery.data.limit));
    return;
  }

  sendJson(
    res,
    200,
    exchangeAnalyticsStore.getAdvertiserDashboard({
      advertiserId: route.advertiserId,
      granularity: parsedQuery.data.granularity,
      limit: parsedQuery.data.limit
    })
  );
});

export const handleExchangeDashboard = withAuth(async (req: IncomingMessage, res: ServerResponse, token) => {
  const route = parseAdvertiserRoute(req.url);
  if (!route || route.view !== "dashboard") {
    sendJson(res, 404, { error: "Exchange dashboard route not found" });
    return;
  }

  if (route.advertiserId !== token.sub) {
    sendJson(res, 403, { error: "Advertiser scope does not match authenticated subject" });
    return;
  }

  const rawAuthorization = req.headers.authorization?.slice(7) ?? "";
  sendHtml(res, 200, getAdvertiserDashboardHtml({ advertiserId: route.advertiserId, token: rawAuthorization }));
});

export const handleExchangeFraudModel = withAuth(async (_req: IncomingMessage, res: ServerResponse) => {
  sendJson(res, 200, {
    model: adExchangeEngine.getFraudModelSnapshot(),
    featureDrift: adExchangeEngine.getFraudFeatureDrift()
  });
});

/**
 * POST /api/v1/exchange/bid
 *
 * High-frequency in-process exchange bid via ring-buffer (HFB).
 * Returns the assigned stream ID (mirrors Redis Stream entry ID format).
 * If the buffer is full (back-pressure), returns 429.
 *
 * Immediately drains a small batch after submission so tests can observe
 * clearing results synchronously.
 */
export const handleHfbExchangeBid = withAuth(async (req: IncomingMessage, res: ServerResponse) => {
  const raw = await readJson(req);
  const parsed = HFBBidSchema.safeParse(raw);

  if (!parsed.success) {
    const errors = parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`);
    logger.warn({ errors }, "HFB exchange bid validation failed");
    sendJson(res, 422, { error: "Validation failed", details: errors });
    return;
  }

  const bid = {
    ...parsed.data,
    submittedAt: new Date().toISOString()
  };

  const streamId = hfbExchange.submit(bid);

  if (streamId === null) {
    sendJson(res, 429, { error: "Exchange buffer full – retry later" });
    return;
  }

  logger.debug({ streamId, adSlotId: bid.adSlotId }, "HFB exchange bid submitted");

  // Eagerly drain a batch so the result is available without a separate call
  const cleared = hfbExchange.drain(64);

  sendJson(res, 200, { streamId, cleared });
});

/**
 * GET /api/v1/exchange/stats
 *
 * Returns throughput and buffer statistics for the HFB exchange.
 */
export const handleHfbExchangeStats = withAuth(async (_req: IncomingMessage, res: ServerResponse) => {
  sendJson(res, 200, hfbExchange.stats());
});
