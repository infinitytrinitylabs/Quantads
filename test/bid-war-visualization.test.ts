import test, { after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { sign } from "jsonwebtoken";
import { app } from "../src/server";

const JWT_SECRET = process.env["QUANTMAIL_JWT_SECRET"] ?? "dev-secret-change-in-production";

function makeToken(sub: string): string {
  return sign({ sub, iss: "quantmail" }, JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: 3600
  });
}

function buildBidPayload(args: {
  advertiserId: string;
  creativeId: string;
  auctionId: string;
  slotId: string;
  campaignId: string;
  requestId: string;
  baseOutcomePrice: number;
  bidCeiling?: number;
  marketPressure: number;
  attentionScore: number;
  intentScore: number;
  conversionRate: number;
  verifiedLtv: number;
  occurredAt: string;
}): Record<string, unknown> {
  return {
    advertiserId: args.advertiserId,
    agencyId: `${args.advertiserId}-agency`,
    creativeId: args.creativeId,
    outcomeType: "purchase",
    baseOutcomePrice: args.baseOutcomePrice,
    bidCeiling: args.bidCeiling ?? args.baseOutcomePrice * 8,
    outcomeCount: 9,
    placement: {
      auctionId: args.auctionId,
      slotId: args.slotId,
      campaignId: args.campaignId,
      platform: "quantedits",
      pageUrl: "https://quantads.example/studio/session-1",
      placementPath: "editor.timeline.recommendation-rail",
      adFormat: "native-card",
      viewport: {
        width: 1600,
        height: 900,
        density: 2
      },
      viewabilityEstimate: 0.92,
      floorPrice: Math.max(args.baseOutcomePrice * 0.4, 2),
      reservePrice: Math.max(args.baseOutcomePrice * 0.5, 3),
      marketPressure: args.marketPressure,
      publisherQualityScore: 0.95,
      contentSafetyScore: 0.99,
      geo: {
        country: "US",
        region: "NY",
        city: "New York",
        timezoneOffsetMinutes: -240
      }
    },
    audience: {
      verifiedLtv: args.verifiedLtv,
      intentScore: args.intentScore,
      conversionRate: args.conversionRate,
      recencyMultiplier: 1.07,
      attentionScore: args.attentionScore,
      cohortQualityScore: 0.88,
      historicalCtr: 0.09,
      historicalOutcomeRate: 0.04
    },
    fingerprint: {
      sessionId: `${args.requestId}-session`,
      userId: `${args.requestId}-user`,
      ipHash: `${args.requestId}-ip`,
      deviceIdHash: `${args.requestId}-device`,
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 Safari/605.1.15",
      deviceCategory: "desktop",
      operatingSystem: "macos",
      browserFamily: "safari",
      language: "en-US",
      connectionType: "wifi",
      localHour: 15,
      tabCount: 4,
      pageViewsInSession: 6,
      referrer: "https://quantads.example/home",
      screenColorDepth: 24,
      timezoneOffsetMinutes: -240
    },
    interaction: {
      focusDurationMs: 12000,
      pointerEvents: 24,
      pointerSamples: [
        { dx: 6, dy: 4, dtMs: 120 },
        { dx: 8, dy: 6, dtMs: 180 }
      ],
      scrollDepth: 0.84,
      scrollSamples: [
        { offset: 120, velocity: 0.9, dwellMs: 1000 },
        { offset: 460, velocity: 1.1, dwellMs: 1600 }
      ],
      keyEvents: 4,
      rageClicks: 0,
      copyPasteEvents: 0,
      hoverTargets: 5,
      formInteractions: 1,
      mediaPlayheadMs: 42000
    },
    settlementAddress: `0x${args.requestId}`,
    settlementNetwork: "base",
    requestId: args.requestId,
    occurredAt: args.occurredAt
  };
}

async function submitBid(port: number, token: string, payload: Record<string, unknown>): Promise<void> {
  const placement = payload["placement"] as { auctionId: string; slotId: string };
  const response = await fetch(
    `http://127.0.0.1:${port}/api/v1/exchange/auctions/${placement.auctionId}/slots/${placement.slotId}/bid`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );

  assert.equal(response.status, 200);
}

test("bid war visualization APIs and dashboard render live war-room telemetry", async () => {
  const advertiserId = "adv-bid-war-main-001";
  const competitorA = "adv-bid-war-comp-a";
  const competitorB = "adv-bid-war-comp-b";
  const advertiserToken = makeToken(advertiserId);
  const competitorAToken = makeToken(competitorA);
  const competitorBToken = makeToken(competitorB);

  const server = app.listen(0);
  await once(server, "listening");
  after(() => server.close());

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected numeric port");
  }

  const port = address.port;
  const auctions = [
    {
      auctionId: "bw-auction-001",
      slotId: "slot-a",
      campaignId: "cmp-bw-main-001",
      occurredAt: "2026-04-17T15:00:05.000Z"
    },
    {
      auctionId: "bw-auction-002",
      slotId: "slot-b",
      campaignId: "cmp-bw-main-002",
      occurredAt: "2026-04-17T15:01:10.000Z"
    },
    {
      auctionId: "bw-auction-003",
      slotId: "slot-c",
      campaignId: "cmp-bw-main-003",
      occurredAt: "2026-04-17T15:02:15.000Z"
    }
  ];

  for (let index = 0; index < auctions.length; index += 1) {
    const auction = auctions[index]!;
    const pressure = 1.04 + index * 0.08;

    await submitBid(
      port,
      competitorAToken,
      buildBidPayload({
        advertiserId: competitorA,
        creativeId: `creative-comp-a-${index}`,
        auctionId: auction.auctionId,
        slotId: auction.slotId,
        campaignId: `cmp-comp-a-${index}`,
        requestId: `request-comp-a-${index}`,
        baseOutcomePrice: 13.5 + index,
        marketPressure: pressure,
        attentionScore: 0.78,
        intentScore: 0.73,
        conversionRate: 0.29,
        verifiedLtv: 102 + index * 7,
        occurredAt: auction.occurredAt
      })
    );

    await submitBid(
      port,
      competitorBToken,
      buildBidPayload({
        advertiserId: competitorB,
        creativeId: `creative-comp-b-${index}`,
        auctionId: auction.auctionId,
        slotId: auction.slotId,
        campaignId: `cmp-comp-b-${index}`,
        requestId: `request-comp-b-${index}`,
        baseOutcomePrice: 14 + index * 0.8,
        marketPressure: pressure + 0.02,
        attentionScore: 0.74,
        intentScore: 0.69,
        conversionRate: 0.27,
        verifiedLtv: 97 + index * 6,
        occurredAt: new Date(new Date(auction.occurredAt).getTime() + 1000).toISOString()
      })
    );

    await submitBid(
      port,
      advertiserToken,
      buildBidPayload({
        advertiserId,
        creativeId: `creative-main-${index}`,
        auctionId: auction.auctionId,
        slotId: auction.slotId,
        campaignId: auction.campaignId,
        requestId: `request-main-${index}`,
        baseOutcomePrice: 12 + index,
        bidCeiling: 48,
        marketPressure: pressure + 0.05,
        attentionScore: 0.88 - index * 0.03,
        intentScore: 0.8 - index * 0.02,
        conversionRate: 0.33 - index * 0.01,
        verifiedLtv: 120 + index * 10,
        occurredAt: new Date(new Date(auction.occurredAt).getTime() + 2000).toISOString()
      })
    );
  }

  const snapshotResponse = await fetch(
    `http://127.0.0.1:${port}/api/v1/bid-war/advertisers/${advertiserId}?granularity=minute&candleLimit=60&replayLimit=60`,
    {
      headers: { authorization: `Bearer ${advertiserToken}` }
    }
  );
  assert.equal(snapshotResponse.status, 200);
  const snapshot = (await snapshotResponse.json()) as {
    advertiserId: string;
    candles: Array<{ open: number; close: number }>;
    sniperMode: { bestOpportunity: { recommendedSnipeBid: number } | null; opportunities: unknown[] };
    competitorIntelligence: Array<{ competitorHandle: string; predictedNextBid: number; coefficients: { marketPressure: number } }>;
    strategyAI: Array<{ recommendedBid: number; reasoning: string[] }>;
    replay: Array<{ auctionId: string }>;
    liveAuctions: Array<{ auctionId: string }>;
  };

  assert.equal(snapshot.advertiserId, advertiserId);
  assert.equal(snapshot.candles.length >= 3, true);
  assert.ok(snapshot.candles.every((candle) => candle.open > 0 && candle.close > 0));
  assert.equal(snapshot.sniperMode.opportunities.length >= 1, true);
  assert.ok(snapshot.sniperMode.bestOpportunity);
  assert.equal(snapshot.competitorIntelligence.length >= 2, true);
  assert.ok(snapshot.competitorIntelligence[0]!.competitorHandle.startsWith("cmptr_"));
  assert.ok(snapshot.competitorIntelligence[0]!.predictedNextBid > 0);
  assert.equal(typeof snapshot.competitorIntelligence[0]!.coefficients.marketPressure, "number");
  assert.equal(snapshot.strategyAI.length >= 1, true);
  assert.ok(snapshot.strategyAI[0]!.recommendedBid > 0);
  assert.equal(snapshot.strategyAI[0]!.reasoning.length >= 1, true);
  assert.equal(snapshot.replay.length >= 3, true);
  assert.equal(snapshot.liveAuctions.length >= 3, true);

  const sniperResponse = await fetch(
    `http://127.0.0.1:${port}/api/v1/bid-war/advertisers/${advertiserId}/sniper-mode`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${advertiserToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        auctionId: snapshot.liveAuctions[0]!.auctionId,
        baseOutcomePrice: 12.5,
        audience: {
          verifiedLtv: 128,
          intentScore: 0.79,
          conversionRate: 0.31,
          attentionScore: 0.86,
          recencyMultiplier: 1.05
        },
        marketPressure: 1.16,
        floorPrice: 6.5,
        maxPrice: 42,
        riskTolerance: 0.26,
        maxIncrement: 3,
        aggression: 0.64,
        objective: "sniper"
      })
    }
  );
  assert.equal(sniperResponse.status, 200);
  const sniperBody = (await sniperResponse.json()) as {
    opportunity: { recommendedSnipeBid: number; auctionId: string } | null;
  };
  assert.ok(sniperBody.opportunity);
  assert.ok((sniperBody.opportunity?.recommendedSnipeBid ?? 0) > 0);

  const strategyResponse = await fetch(
    `http://127.0.0.1:${port}/api/v1/bid-war/advertisers/${advertiserId}/strategy/optimize`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${advertiserToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        baseOutcomePrice: 13,
        audience: {
          verifiedLtv: 132,
          intentScore: 0.8,
          conversionRate: 0.32,
          attentionScore: 0.87,
          recencyMultiplier: 1.06
        },
        marketPressure: 1.14,
        floorPrice: 6.5,
        maxPrice: 40,
        riskTolerance: 0.24,
        objective: "balanced",
        competitionIndex: 0.82,
        sniperMode: false,
        marginGuardrail: 0.25
      })
    }
  );
  assert.equal(strategyResponse.status, 200);
  const strategyBody = (await strategyResponse.json()) as {
    recommendedBid: number;
    confidence: number;
    reasoning: string[];
    scenarioMatrix: Array<{ bid: number }>;
  };
  assert.ok(strategyBody.recommendedBid > 0);
  assert.ok(strategyBody.confidence > 0);
  assert.equal(strategyBody.reasoning.length >= 3, true);
  assert.equal(strategyBody.scenarioMatrix.length, 3);

  const roomResponse = await fetch(`http://127.0.0.1:${port}/advertisers/${advertiserId}/bid-war-room`, {
    headers: { authorization: `Bearer ${advertiserToken}` }
  });
  assert.equal(roomResponse.status, 200);
  const roomHtml = await roomResponse.text();
  assert.match(roomHtml, /Quantads Bid War Visualization/);
  assert.match(roomHtml, /candlestick-canvas/);
  assert.match(roomHtml, /CompetitorIntelligence Regression/);
  assert.match(roomHtml, /BidStrategyAI Auto-Optimizer/);
  assert.match(roomHtml, /api\/v1\/bid-war\/advertisers/);
});

after(() => {
  app.close();
});
