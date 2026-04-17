import { createHash } from "node:crypto";
import { IncomingMessage, Server } from "node:http";
import { Duplex } from "node:stream";
import { verifyQuantmailToken } from "../middleware/auth";
import { logger } from "../lib/logger";
import { ExchangeAnalyticsStore, exchangeAnalyticsStore } from "./ExchangeAnalyticsStore";
import { AdvertiserDashboardSnapshot, DashboardSocketEnvelope, ExchangeAnalyticsEvent } from "./types";
import { nowIso } from "./math";

interface WebSocketClient {
  advertiserId: string;
  socket: Duplex;
  authorizedSubject: string;
  heartbeatTimer?: NodeJS.Timeout;
}

const MAGIC_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const buildAcceptKey = (key: string): string =>
  createHash("sha1")
    .update(`${key}${MAGIC_GUID}`)
    .digest("base64");

const encodeFrame = (payload: string, opcode = 0x1): Buffer => {
  const payloadBuffer = Buffer.from(payload);
  const length = payloadBuffer.length;

  if (length < 126) {
    return Buffer.concat([Buffer.from([0x80 | opcode, length]), payloadBuffer]);
  }

  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payloadBuffer]);
  }

  const header = Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, payloadBuffer]);
};

const decodeFrames = (buffer: Buffer): Array<{ opcode: number; payload: Buffer }> => {
  const frames: Array<{ opcode: number; payload: Buffer }> = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const firstByte = buffer[offset];
    const secondByte = buffer[offset + 1];
    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) !== 0;
    let payloadLength = secondByte & 0x7f;
    let headerLength = 2;

    if (payloadLength === 126) {
      if (offset + 4 > buffer.length) {
        break;
      }
      payloadLength = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (payloadLength === 127) {
      if (offset + 10 > buffer.length) {
        break;
      }
      payloadLength = Number(buffer.readBigUInt64BE(offset + 2));
      headerLength = 10;
    }

    const maskOffset = masked ? 4 : 0;
    const frameLength = headerLength + maskOffset + payloadLength;
    if (offset + frameLength > buffer.length) {
      break;
    }

    const maskStart = offset + headerLength;
    const payloadStart = maskStart + maskOffset;
    let payload = buffer.subarray(payloadStart, payloadStart + payloadLength);

    if (masked) {
      const mask = buffer.subarray(maskStart, maskStart + 4);
      const unmasked = Buffer.alloc(payloadLength);
      for (let index = 0; index < payloadLength; index += 1) {
        unmasked[index] = payload[index] ^ mask[index % 4]!;
      }
      payload = unmasked;
    }

    frames.push({ opcode, payload });
    offset += frameLength;
  }

  return frames;
};

export class RealtimeAnalyticsHub {
  private readonly clients = new Set<WebSocketClient>();

  constructor(private readonly store: ExchangeAnalyticsStore = exchangeAnalyticsStore) {
    this.store.subscribe((snapshot, event) => {
      this.broadcast(snapshot, event);
    });
  }

  attach(server: Server): void {
    server.on("upgrade", (request, socket) => {
      if (!(request.url ?? "").startsWith("/ws/analytics")) {
        socket.destroy();
        return;
      }

      try {
        this.handleUpgrade(request, socket);
      } catch (error) {
        const message = error instanceof Error ? error.message : "upgrade failed";
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        logger.warn({ err: message }, "analytics websocket upgrade failed");
      }
    });
  }

  private handleUpgrade(request: IncomingMessage, socket: Duplex): void {
    const url = new URL(request.url ?? "/ws/analytics", "http://127.0.0.1");
    const advertiserId = url.searchParams.get("advertiserId") ?? "";
    const token = url.searchParams.get("token") ?? "";
    const auth = verifyQuantmailToken(token ? `Bearer ${token}` : undefined);

    if (!advertiserId) {
      throw new Error("Missing advertiserId");
    }

    if (!request.headers["sec-websocket-key"]) {
      throw new Error("Missing websocket key");
    }

    const accept = buildAcceptKey(request.headers["sec-websocket-key"]);
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "\r\n"
      ].join("\r\n")
    );

    const client: WebSocketClient = {
      advertiserId,
      socket,
      authorizedSubject: auth.sub
    };

    this.clients.add(client);
    this.startHeartbeat(client);
    this.send(client, {
      type: "hello",
      advertiserId,
      generatedAt: nowIso(),
      payload: {
        message: "Quantads analytics stream connected",
        subject: auth.sub,
        snapshot: this.store.getAdvertiserDashboard({ advertiserId, granularity: "minute", limit: 60 })
      }
    });

    let buffered = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, typeof chunk === "string" ? Buffer.from(chunk) : chunk]);
      const frames = decodeFrames(buffered);
      buffered = Buffer.alloc(0);
      for (const frame of frames) {
        this.handleFrame(client, frame.opcode, frame.payload);
      }
    });

    socket.on("close", () => this.disconnect(client));
    socket.on("end", () => this.disconnect(client));
    socket.on("error", () => this.disconnect(client));
  }

  private handleFrame(client: WebSocketClient, opcode: number, payload: Buffer): void {
    if (opcode === 0x8) {
      this.disconnect(client);
      return;
    }

    if (opcode === 0x9) {
      client.socket.write(encodeFrame(payload.toString("utf8"), 0xA));
      return;
    }

    if (opcode !== 0x1) {
      return;
    }

    try {
      const message = JSON.parse(payload.toString("utf8")) as { advertiserId?: string; type?: string };
      if (message.type === "subscribe" && message.advertiserId) {
        client.advertiserId = message.advertiserId;
        this.send(client, {
          type: "snapshot",
          advertiserId: client.advertiserId,
          generatedAt: nowIso(),
          payload: this.store.getAdvertiserDashboard({
            advertiserId: client.advertiserId,
            granularity: "minute",
            limit: 60
          }) as unknown as Record<string, unknown>
        });
      }
    } catch (error) {
      this.send(client, {
        type: "error",
        advertiserId: client.advertiserId,
        generatedAt: nowIso(),
        payload: {
          error: error instanceof Error ? error.message : "Invalid websocket payload"
        }
      });
    }
  }

  private broadcast(snapshot: AdvertiserDashboardSnapshot, event: ExchangeAnalyticsEvent): void {
    for (const client of this.clients) {
      if (client.advertiserId !== snapshot.advertiserId) {
        continue;
      }

      this.send(client, {
        type: "event",
        advertiserId: snapshot.advertiserId,
        generatedAt: nowIso(),
        payload: {
          event,
          snapshot
        }
      });
    }
  }

  private send(client: WebSocketClient, envelope: DashboardSocketEnvelope): void {
    if (client.socket.destroyed) {
      this.disconnect(client);
      return;
    }

    client.socket.write(encodeFrame(JSON.stringify(envelope)));
  }

  private startHeartbeat(client: WebSocketClient): void {
    client.heartbeatTimer = setInterval(() => {
      if (client.socket.destroyed) {
        this.disconnect(client);
        return;
      }

      this.send(client, {
        type: "heartbeat",
        advertiserId: client.advertiserId,
        generatedAt: nowIso(),
        payload: {
          subject: client.authorizedSubject
        }
      });
    }, 15000);
  }

  private disconnect(client: WebSocketClient): void {
    if (client.heartbeatTimer) {
      clearInterval(client.heartbeatTimer);
    }
    this.clients.delete(client);
    if (!client.socket.destroyed) {
      client.socket.end();
    }
  }
}

export const realtimeAnalyticsHub = new RealtimeAnalyticsHub();
