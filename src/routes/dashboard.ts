import { IncomingMessage, ServerResponse } from "node:http";
import { outcomeStore } from "../lib/outcome-store";
import { attentionStore } from "../bci/AttentionStore";
import { hfbExchange } from "../exchange/HFBExchange";
import { withAuth } from "../middleware/auth";
import { logger } from "../lib/logger";

const SSE_HEARTBEAT_MS = 15_000;

/**
 * GET /api/v1/dashboard/stream
 *
 * Server-Sent Events endpoint that pushes real-time advertiser analytics to
 * connected dashboard clients.  No external WebSocket library is required.
 *
 * Event types emitted:
 *  - `snapshot`   – full analytics snapshot (emitted on connection and every 5 s)
 *  - `heartbeat`  – keep-alive ping every 15 s
 *
 * Clients authenticate via a valid Quantmail JWT Bearer token.
 */
export const handleDashboardStream = withAuth(async (req: IncomingMessage, res: ServerResponse) => {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
    "x-accel-buffering": "no"  // disable nginx proxy buffering
  });

  const clientIp = req.socket.remoteAddress ?? "unknown";
  logger.info({ clientIp }, "dashboard SSE client connected");

  function buildSnapshot() {
    const performance = outcomeStore.getPerformanceSummary();
    const exchange = hfbExchange.stats();
    const activeAttentionUsers = attentionStore.activeUserIds().length;

    return {
      timestamp: new Date().toISOString(),
      performance,
      exchange,
      activeAttentionUsers
    };
  }

  function sendEvent(eventType: string, data: unknown): void {
    const payload = JSON.stringify(data);
    res.write(`event: ${eventType}\ndata: ${payload}\n\n`);
  }

  // Send initial snapshot immediately
  sendEvent("snapshot", buildSnapshot());

  // Periodic snapshot every 5 s
  const snapshotInterval = setInterval(() => {
    try {
      sendEvent("snapshot", buildSnapshot());
    } catch (err) {
      // Ignore write errors from disconnected clients; res.destroyed guards the rest
      if (res.destroyed) {
        clearInterval(snapshotInterval);
      } else {
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, "dashboard snapshot error");
      }
    }
  }, 5_000);

  // Heartbeat every 15 s
  const heartbeatInterval = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch {
      // Client disconnected; cleanup will happen on the 'close' event
      if (res.destroyed) {
        clearInterval(heartbeatInterval);
      }
    }
  }, SSE_HEARTBEAT_MS);

  // Clean up on client disconnect
  req.on("close", () => {
    clearInterval(snapshotInterval);
    clearInterval(heartbeatInterval);
    logger.info({ clientIp }, "dashboard SSE client disconnected");
  });
});
