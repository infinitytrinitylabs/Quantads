import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { sign } from "jsonwebtoken";
import { app } from "../src/server";
import { FocusAggregator } from "../src/services/FocusAggregator";
import { FormatShifter } from "../src/services/FormatShifter";
import { AdRewardsUI } from "../src/components/AdRewardsUI";

const JWT_SECRET = process.env["QUANTMAIL_JWT_SECRET"] ?? "dev-secret-change-in-production";

const makeToken = (sub = "attention-span-user"): string =>
  sign({ sub, iss: "quantmail" }, JWT_SECRET, { algorithm: "HS256", expiresIn: 3600 });

test("FocusAggregator computes abstract attention depth without exposing raw telemetry", () => {
  const aggregator = new FocusAggregator();
  aggregator.ingest({ scrollPauseMs: 150, interactionCount: 1, sampleWindowMs: 5000 });
  const snapshot = aggregator.ingest({ scrollPauseMs: 4200, interactionCount: 10, sampleWindowMs: 5000 });

  assert.ok(snapshot.attentionDepthScore >= 0 && snapshot.attentionDepthScore <= 1);
  assert.ok(["fragmented", "steady", "deep"].includes(snapshot.attentionDepth));
  assert.equal(Object.hasOwn(snapshot, "scrollPauseMs"), false);
  assert.equal(Object.hasOwn(snapshot, "interactionCount"), false);
});

test("FormatShifter returns narrative mode for deep attention and sub-3s burst mode for fragmented attention", () => {
  const shifter = new FormatShifter();
  const high = shifter.selectDelivery({ attentionDepthScore: 0.88 });
  const low = shifter.selectDelivery({ attentionDepthScore: 0.22, skipRate: 0.5 });

  assert.equal(high.mode, "narrative-longform");
  assert.ok(high.maxDurationSeconds > 3);
  assert.equal(low.mode, "micro-burst");
  assert.ok(low.maxDurationSeconds < 3);
});

test("AdRewardsUI renders engagement reward widget with progress state", () => {
  const rewards = new AdRewardsUI().render({
    points: 95,
    unskippedViews: 3,
    streakDays: 8,
    nextRewardAt: 5
  });

  assert.ok(rewards.html.includes("Engagement rewards"));
  assert.ok(rewards.html.includes("95 pts"));
  assert.ok(rewards.html.includes("Silver Focus"));
  assert.ok(rewards.styles.includes(".qad-rewards-meter"));
});

test("POST /api/v1/smart-ads/render supports dynamic delivery and rewards widget", async () => {
  const server = app.listen(0);
  await once(server, "listening");

  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected numeric port");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/smart-ads/render`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${makeToken()}`
      },
      body: JSON.stringify({
        campaignId: "cmp-attention-optimizer",
        attentionScore: 0.31,
        emotionalState: "neutral",
        context: "feed browsing",
        deviceType: "mobile",
        localHour: 13,
        format: "interstitial",
        dynamicDelivery: true,
        focusTelemetry: {
          scrollPauseMs: 120,
          interactionCount: 1,
          sampleWindowMs: 5000,
          skipCount: 1
        },
        rewardProgress: {
          points: 120,
          unskippedViews: 4,
          streakDays: 11,
          nextRewardAt: 6
        }
      })
    });

    assert.equal(response.status, 200);
    const body = await response.json() as {
      format: string;
      requestedFormat: string;
      attentionDepth?: { attentionDepth: string; attentionDepthScore: number };
      deliveryPlan?: { mode: string; maxDurationSeconds: number };
      rewardsWidget?: { html: string; styles: string };
    };

    assert.equal(body.requestedFormat, "interstitial");
    assert.equal(body.format, "banner-mobile");
    assert.equal(body.deliveryPlan?.mode, "micro-burst");
    assert.ok((body.deliveryPlan?.maxDurationSeconds ?? 9) < 3);
    assert.ok(["fragmented", "steady", "deep"].includes(body.attentionDepth?.attentionDepth ?? ""));
    assert.ok((body.attentionDepth?.attentionDepthScore ?? -1) >= 0);
    assert.ok(body.rewardsWidget?.html.includes("Engagement rewards"));
  } finally {
    server.close();
  }
});
