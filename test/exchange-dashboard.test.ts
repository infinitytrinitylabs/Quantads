import test, { after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { sign } from "jsonwebtoken";
import { app } from "../src/server";

const JWT_SECRET = process.env["QUANTMAIL_JWT_SECRET"] ?? "dev-secret-change-in-production";

function makeToken(sub = "adv-dashboard-001", expiresIn = 3600): string {
  return sign({ sub, iss: "quantmail" }, JWT_SECRET, {
    algorithm: "HS256",
    expiresIn
  });
}

function waitForSocketMessage(socket: WebSocket, predicate: (payload: any) => boolean, timeoutMs = 4000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for websocket message"));
    }, timeoutMs);

    const handleMessage = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data);
        if (predicate(parsed)) {
          cleanup();
          resolve(parsed);
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener("message", handleMessage as EventListener);
    };

    socket.addEventListener("message", handleMessage as EventListener);
  });
}

test("exchange analytics API, dashboard HTML, and websocket stream work together", async () => {
  const advertiserId = "adv-dashboard-001";
  const token = makeToken(advertiserId);
  const server = app.listen(0);
  let socket: WebSocket | undefined;
  await once(server, "listening");

  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected numeric port");
    }

    socket = new WebSocket(
      `ws://127.0.0.1:${address.port}/ws/analytics?advertiserId=${encodeURIComponent(advertiserId)}&token=${encodeURIComponent(token)}`
    );
    await once(socket as unknown as EventTarget, "open");
    const hello = await waitForSocketMessage(socket, (payload) => payload.type === "hello");
    assert.equal(hello.advertiserId, advertiserId);
    assert.equal(hello.payload.snapshot.advertiserId, advertiserId);
    const liveEventPromise = waitForSocketMessage(socket, (payload) => payload.type === "event");

    const bidResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/exchange/auctions/auction-live-001/slots/slot-live-001/bid`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          advertiserId,
          agencyId: "agency-live-001",
          creativeId: "creative-live-001",
          outcomeType: "app-install",
          baseOutcomePrice: 12,
          bidCeiling: 80,
          outcomeCount: 10,
          placement: {
            auctionId: "auction-live-001",
            slotId: "slot-live-001",
            campaignId: "cmp-live-001",
            platform: "quanttube",
            pageUrl: "https://quantads.example/watch/episode-1",
            placementPath: "player.endcard.slot-a",
            adFormat: "video",
            viewport: { width: 1920, height: 1080, density: 2 },
            viewabilityEstimate: 0.91,
            floorPrice: 5,
            reservePrice: 6,
            marketPressure: 1.12,
            publisherQualityScore: 0.93,
            contentSafetyScore: 0.99,
            geo: { country: "US", region: "NY", city: "New York", timezoneOffsetMinutes: -240 }
          },
          audience: {
            verifiedLtv: 95,
            intentScore: 0.77,
            conversionRate: 0.38,
            recencyMultiplier: 1.08,
            attentionScore: 0.88,
            cohortQualityScore: 0.82,
            historicalCtr: 0.08,
            historicalOutcomeRate: 0.03
          },
          fingerprint: {
            sessionId: "session-live-001",
            userId: "user-live-001",
            ipHash: "ip-live-001",
            deviceIdHash: "device-live-001",
            userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 Version/18.4 Mobile Safari/605.1.15",
            deviceCategory: "mobile",
            operatingSystem: "ios",
            browserFamily: "safari",
            language: "en-US",
            connectionType: "wifi",
            localHour: 16,
            tabCount: 2,
            pageViewsInSession: 4,
            referrer: "https://quantads.example/home",
            screenColorDepth: 24,
            timezoneOffsetMinutes: -240
          },
          interaction: {
            focusDurationMs: 9600,
            pointerEvents: 18,
            pointerSamples: [
              { dx: 3, dy: 5, dtMs: 140 },
              { dx: 6, dy: 4, dtMs: 180 }
            ],
            scrollDepth: 0.72,
            scrollSamples: [
              { offset: 180, velocity: 0.8, dwellMs: 1200 },
              { offset: 420, velocity: 1, dwellMs: 1600 }
            ],
            keyEvents: 0,
            rageClicks: 0,
            copyPasteEvents: 0,
            hoverTargets: 3,
            formInteractions: 1,
            mediaPlayheadMs: 145000
          },
          settlementAddress: "0xlive-001",
          settlementNetwork: "base"
        })
      }
    );

    assert.equal(bidResponse.status, 200);
    const bidBody = await bidResponse.json() as { status: string; pricing: { attentionMultiplier: number } };
    assert.notEqual(bidBody.status, "rejected");
    assert.ok(bidBody.pricing.attentionMultiplier > 1);

    const liveEvent = await liveEventPromise;
    assert.equal(liveEvent.payload.event.advertiserId, advertiserId);
    assert.equal(liveEvent.payload.snapshot.summary.totalRequests >= 1, true);

    const analyticsResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/exchange/analytics/advertisers/${advertiserId}?granularity=minute&limit=10`,
      {
        headers: { authorization: `Bearer ${token}` }
      }
    );
    assert.equal(analyticsResponse.status, 200);
    const analyticsBody = await analyticsResponse.json() as {
      summary: { totalRequests: number; acceptedBids: number };
      timeline: Array<{ averageAttentionScore: number }>;
      liveAuctions: Array<{ auctionId: string }>;
    };
    assert.equal(analyticsBody.summary.totalRequests >= 1, true);
    assert.equal(analyticsBody.summary.acceptedBids >= 1, true);
    assert.equal(analyticsBody.liveAuctions[0]?.auctionId, "auction-live-001");
    assert.ok((analyticsBody.timeline[0]?.averageAttentionScore ?? 0) > 0);

    const dashboardResponse = await fetch(
      `http://127.0.0.1:${address.port}/advertisers/${advertiserId}/exchange-dashboard`,
      {
        headers: { authorization: `Bearer ${token}` }
      }
    );
    assert.equal(dashboardResponse.status, 200);
    const dashboardHtml = await dashboardResponse.text();
    assert.match(dashboardHtml, /Quantads Exchange Dashboard/);
    assert.match(dashboardHtml, /\/ws\/analytics\?advertiserId=/);
    assert.match(dashboardHtml, /Real-time Exchange Curves/);
  } finally {
    socket?.close();
    server.close();
  }
});

after(() => {
  app.close();
});
