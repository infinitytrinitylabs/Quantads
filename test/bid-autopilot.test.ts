import test from "node:test";
import assert from "node:assert/strict";
import { BidAutopilotService } from "../src/services/BidAutopilotService";

test("BidAutopilotService defaults to recommend mode (opt-in)", () => {
  const svc = new BidAutopilotService();
  const p = svc.createPolicy({
    campaignId: "c1",
    advertiserId: "a1",
    startingBid: 1.0,
    minBid: 0.5,
    maxBid: 2.0,
    dailyBudgetCap: 100
  });
  assert.equal(p.mode, "recommend");

  const result = svc.evaluate(p.id, {
    conversionRate: 0.8,
    attentionScore: 0.9,
    marketPressure: 1.2,
    impressions: 1000,
    projectedAdditionalSpend: 10
  });
  assert.equal(result.applied, false, "recommend mode never auto-applies");
  assert.equal(result.appliedBid, 1.0, "bid unchanged in recommend mode");
  assert.ok(result.recommendedBid > 1.0, "recommendation reflects positive signal");
});

test("BidAutopilotService auto_apply respects bid bounds", () => {
  const svc = new BidAutopilotService();
  const p = svc.createPolicy({
    campaignId: "c2",
    advertiserId: "a2",
    startingBid: 1.0,
    minBid: 0.5,
    maxBid: 2.0,
    dailyBudgetCap: 1_000_000,
    maxAdjustmentPerStep: 0.5
  });
  svc.setMode(p.id, "auto_apply");

  // Huge positive signal — but capped by maxBid
  for (let i = 0; i < 20; i++) {
    svc.evaluate(p.id, {
      conversionRate: 1,
      attentionScore: 1,
      marketPressure: 3,
      impressions: 100
    });
  }
  const final = svc.getPolicy(p.id);
  assert.ok(final);
  assert.ok(final.currentBid <= 2.0);
  assert.ok(final.currentBid >= 0.5);
});

test("BidAutopilotService respects the daily budget cap", () => {
  const svc = new BidAutopilotService();
  const p = svc.createPolicy({
    campaignId: "c3",
    advertiserId: "a3",
    startingBid: 1.0,
    minBid: 0.5,
    maxBid: 2.0,
    dailyBudgetCap: 50
  });
  svc.setMode(p.id, "auto_apply");

  const ok = svc.evaluate(p.id, {
    conversionRate: 0.8,
    attentionScore: 0.8,
    marketPressure: 1,
    impressions: 100,
    projectedAdditionalSpend: 40
  });
  assert.equal(ok.applied, true);

  const blocked = svc.evaluate(p.id, {
    conversionRate: 0.8,
    attentionScore: 0.8,
    marketPressure: 1,
    impressions: 100,
    projectedAdditionalSpend: 20
  });
  assert.equal(blocked.applied, false);
  assert.ok(blocked.capsEnforced.includes("dailyBudgetCap"));
});

test("BidAutopilotService maintains a full per-change audit log", () => {
  const svc = new BidAutopilotService();
  const p = svc.createPolicy({
    campaignId: "c4",
    advertiserId: "a4",
    startingBid: 1.0,
    minBid: 0.5,
    maxBid: 2.0,
    dailyBudgetCap: 100
  });
  svc.evaluate(p.id, { conversionRate: 0.9, attentionScore: 0.9, marketPressure: 1, impressions: 10 });
  svc.evaluate(p.id, { conversionRate: 0.1, attentionScore: 0.1, marketPressure: 1, impressions: 10 });

  const audit = svc.getAudit(p.id);
  assert.equal(audit.length, 2);
  assert.ok(audit.every((e) => typeof e.rationale === "string" && e.rationale.length > 0));
  assert.ok(audit.every((e) => e.id && e.at && e.policyId === p.id));
});

test("BidAutopilotService paused mode halts auto_apply", () => {
  const svc = new BidAutopilotService();
  const p = svc.createPolicy({
    campaignId: "c5",
    advertiserId: "a5",
    startingBid: 1.0,
    minBid: 0.5,
    maxBid: 2.0,
    dailyBudgetCap: 100
  });
  svc.setMode(p.id, "paused");
  const r = svc.evaluate(p.id, { conversionRate: 0.9, attentionScore: 0.9, marketPressure: 1, impressions: 10 });
  assert.equal(r.applied, false);
});

test("BidAutopilotService rejects invalid policy parameters", () => {
  const svc = new BidAutopilotService();
  assert.throws(() =>
    svc.createPolicy({
      campaignId: "c",
      advertiserId: "a",
      startingBid: 10,
      minBid: 1,
      maxBid: 2,
      dailyBudgetCap: 100
    })
  );
  assert.throws(() =>
    svc.createPolicy({
      campaignId: "c",
      advertiserId: "a",
      startingBid: 1,
      minBid: 2,
      maxBid: 1,
      dailyBudgetCap: 100
    })
  );
});
