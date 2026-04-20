import { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { withAuth } from "../middleware/auth";
import { auctionTickerService } from "../services/AuctionTickerService";
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

export const TickerPublishSchema = z.object({
  advertiserId: z.string().min(1),
  category: z.string().min(1).max(64),
  amount: z.number().positive(),
  currency: z.string().min(3).max(5).optional(),
  occurredAt: z.string().datetime().optional()
});

export const TickerOptOutSchema = z.object({
  advertiserId: z.string().min(1),
  optOut: z.boolean()
});

export const handleTickerPublish = withAuth(async (req, res) => {
  const raw = await readJson(req);
  const parsed = TickerPublishSchema.safeParse(raw);
  if (!parsed.success) {
    sendJson(res, 422, {
      error: "Validation failed",
      details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
    });
    return;
  }

  const event = auctionTickerService.publish(parsed.data);
  if (!event) {
    sendJson(res, 202, { published: false, reason: "rate_limited_or_opted_out" });
    return;
  }
  sendJson(res, 201, { published: true, event });
});

export const handleTickerRecent = withAuth(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const limit = Number(url.searchParams.get("limit") ?? "50");
  sendJson(res, 200, auctionTickerService.snapshot(Number.isFinite(limit) ? limit : 50));
});

export const handleTickerOptOut = withAuth(async (req, res) => {
  const raw = await readJson(req);
  const parsed = TickerOptOutSchema.safeParse(raw);
  if (!parsed.success) {
    sendJson(res, 422, {
      error: "Validation failed",
      details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
    });
    return;
  }
  if (parsed.data.optOut) {
    auctionTickerService.optOut(parsed.data.advertiserId);
  } else {
    auctionTickerService.optIn(parsed.data.advertiserId);
  }
  sendJson(res, 200, {
    advertiserId: parsed.data.advertiserId,
    optedOut: auctionTickerService.isOptedOut(parsed.data.advertiserId)
  });
});

/**
 * GET /api/v1/ticker/stream — Server-Sent Events subscription.
 *
 * Emits public ticker events as text/event-stream. Each event has the
 * shape described in `PublicTickerEvent`. Connections are closed
 * cleanly on client disconnect.
 */
export const handleTickerStream = withAuth(async (req: IncomingMessage, res: ServerResponse) => {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive"
  });

  // Send initial snapshot so clients render instantly
  const snap = auctionTickerService.snapshot(20);
  res.write(`event: snapshot\ndata: ${JSON.stringify(snap)}\n\n`);

  const unsubscribe = auctionTickerService.subscribe((ev) => {
    try {
      res.write(`event: bid\ndata: ${JSON.stringify(ev)}\n\n`);
    } catch (err) {
      logger.debug({ err }, "ticker stream write error");
      close();
    }
  });

  const heartbeat = setInterval(() => {
    try {
      res.write(`: keepalive ${Date.now()}\n\n`);
    } catch (err) {
      logger.debug({ err }, "ticker heartbeat write error");
      close();
    }
  }, 15_000);

  const close = (): void => {
    clearInterval(heartbeat);
    unsubscribe();
    try {
      res.end();
    } catch (err) {
      logger.debug({ err }, "ticker stream close error");
    }
  };

  req.on("close", close);
  req.on("aborted", close);
});
