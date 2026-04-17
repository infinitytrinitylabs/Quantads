import test from "node:test";
import assert from "node:assert/strict";
import { AdExchangeEngine } from "../src/exchange/AdExchangeEngine";
import { ExchangeAnalyticsStore } from "../src/exchange/ExchangeAnalyticsStore";
import { ExchangeBidRequest } from "../src/exchange/types";

const makeBid = (overrides: Partial<ExchangeBidRequest> = {}): ExchangeBidRequest => ({
  advertiserId: "adv-exchange-001",
  agencyId: "agency-001",
  creativeId: "creative-alpha",
  outcomeType: "booked-meeting",
  baseOutcomePrice: 24,
  bidCeiling: 180,
  outcomeCount: 4,
  pricingCurrency: "USDC",
  placement: {
    auctionId: "auction-001",
    slotId: "slot-top-banner",
    campaignId: "cmp-exchange-001",
    platform: "quantedits",
    pageUrl: "https://quantads.example/editor",
    placementPath: "editor.sidebar.slot-a",
    adFormat: "native-card",
    viewport: {
      width: 1440,
      height: 900,
      density: 2
    },
    viewabilityEstimate: 0.82,
    floorPrice: 8,
    reservePrice: 10,
    marketPressure: 1.05,
    publisherQualityScore: 0.88,
    contentSafetyScore: 0.97,
    geo: {
      country: "US",
      region: "CA",
      city: "San Francisco",
      timezoneOffsetMinutes: -420
    }
  },
  audience: {
    verifiedLtv: 180,
    intentScore: 0.79,
    conversionRate: 0.42,
    recencyMultiplier: 1.12,
    attentionScore: 0.86,
    cohortQualityScore: 0.83,
    historicalCtr: 0.09,
    historicalOutcomeRate: 0.04
  },
  fingerprint: {
    sessionId: "session-a",
    userId: "user-a",
    ipHash: "ip-a",
    deviceIdHash: "device-a",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
    deviceCategory: "desktop",
    operatingSystem: "macos",
    browserFamily: "chrome",
    language: "en-US",
    connectionType: "wifi",
    localHour: 14,
    tabCount: 3,
    pageViewsInSession: 5,
    referrer: "https://quantads.example/feed",
    screenColorDepth: 24,
    timezoneOffsetMinutes: -420
  },
  interaction: {
    focusDurationMs: 7200,
    pointerEvents: 32,
    pointerSamples: [
      { dx: 8, dy: 3, dtMs: 120 },
      { dx: 12, dy: 6, dtMs: 160 },
      { dx: 4, dy: 10, dtMs: 180 }
    ],
    scrollDepth: 0.66,
    scrollSamples: [
      { offset: 120, velocity: 0.8, dwellMs: 900 },
      { offset: 340, velocity: 1.1, dwellMs: 1100 }
    ],
    keyEvents: 3,
    rageClicks: 0,
    copyPasteEvents: 1,
    hoverTargets: 8,
    formInteractions: 2,
    mediaPlayheadMs: 0
  },
  settlementAddress: "0xadv-a",
  settlementNetwork: "base",
  occurredAt: new Date("2026-04-17T12:00:00.000Z").toISOString(),
  ...overrides
});

test("AdExchangeEngine clears auctions at second price with BCI attention lift", () => {
  const analyticsStore = new ExchangeAnalyticsStore();
  const engine = new AdExchangeEngine(analyticsStore);

  const premiumBid = engine.submitBid(
    makeBid({
      creativeId: "creative-premium",
      advertiserId: "adv-premium",
      agencyId: "agency-premium",
      audience: {
        ...makeBid().audience,
        attentionScore: 0.92,
        verifiedLtv: 220,
        conversionRate: 0.46
      },
      fingerprint: {
        ...makeBid().fingerprint,
        sessionId: "session-premium",
        userId: "user-premium",
        ipHash: "ip-premium",
        deviceIdHash: "device-premium"
      }
    })
  );

  const challengerBid = engine.submitBid(
    makeBid({
      creativeId: "creative-challenger",
      advertiserId: "adv-challenger",
      agencyId: "agency-challenger",
      audience: {
        ...makeBid().audience,
        attentionScore: 0.48,
        verifiedLtv: 150,
        conversionRate: 0.3
      },
      fingerprint: {
        ...makeBid().fingerprint,
        sessionId: "session-challenger",
        userId: "user-challenger",
        ipHash: "ip-challenger",
        deviceIdHash: "device-challenger"
      }
    })
  );

  const snapshot = engine.getAuctionSnapshot("auction-001", "slot-top-banner");
  assert.equal(snapshot.winner?.advertiserId, "adv-premium");
  assert.equal(premiumBid.isWinner, true);
  assert.equal(challengerBid.isWinner, false);
  assert.ok(premiumBid.pricing.attentionMultiplier > challengerBid.pricing.attentionMultiplier);
  assert.ok((snapshot.secondPrice ?? 0) >= challengerBid.rankedBid);
  assert.equal(snapshot.leaderboard[0]?.settlementStatus, "won");
  assert.equal(snapshot.leaderboard[1]?.settlementStatus, "outbid");
});

test("AdExchangeEngine rejects automation-heavy traffic with combined fraud defenses", () => {
  const analyticsStore = new ExchangeAnalyticsStore();
  const engine = new AdExchangeEngine(analyticsStore);

  const rejected = engine.submitBid(
    makeBid({
      creativeId: "creative-bot",
      placement: {
        ...makeBid().placement,
        auctionId: "auction-bot",
        slotId: "slot-bot",
        campaignId: "cmp-bot"
      },
      audience: {
        ...makeBid().audience,
        attentionScore: 0.03,
        historicalCtr: 0,
        historicalOutcomeRate: 0
      },
      fingerprint: {
        ...makeBid().fingerprint,
        sessionId: "session-bot",
        userId: "user-bot",
        ipHash: "ip-bot",
        deviceIdHash: "device-bot",
        userAgent: "Mozilla/5.0 HeadlessChrome Playwright webdriver selenium bot",
        browserFamily: "bot",
        connectionType: "offline",
        tabCount: 28,
        pageViewsInSession: 65
      },
      interaction: {
        ...makeBid().interaction,
        focusDurationMs: 0,
        pointerEvents: 0,
        pointerSamples: [],
        scrollDepth: 0,
        rageClicks: 12,
        hoverTargets: 0,
        formInteractions: 0
      }
    })
  );

  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.settlementStatus, "rejected");
  assert.equal(rejected.isWinner, false);
  assert.ok(rejected.diagnostics.combinedScore >= 0.86);
  assert.equal(rejected.diagnostics.tier, "blocked");
  assert.match(rejected.diagnostics.reviewReasons.join(" "), /automation|offline|zero focus/i);
});
