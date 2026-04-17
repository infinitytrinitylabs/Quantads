import test from "node:test";
import assert from "node:assert/strict";
import { AudienceSplitTestService, twoTailedPValue } from "../src/services/AudienceSplitTestService";

test("AudienceSplitTestService finalizes with a statistically significant winner", () => {
  const svc = new AudienceSplitTestService();
  const rec = svc.createTest({
    segmentId: "seg-1",
    metric: "conversion_rate",
    minSampleSize: 100,
    alpha: 0.05,
    variants: [
      { campaignId: "cmp-A", advertiserId: "adv-A" },
      { campaignId: "cmp-B", advertiserId: "adv-B" }
    ]
  });

  // cmp-A: clearly higher conversion rate
  svc.recordVariantActivity(rec.id, "cmp-A", {
    impressions: 2000,
    conversions: 220,
    spend: 200,
    revenue: 660
  });
  svc.recordVariantActivity(rec.id, "cmp-B", {
    impressions: 2000,
    conversions: 120,
    spend: 200,
    revenue: 300
  });

  const done = svc.finalize(rec.id);
  assert.equal(done.status, "finalized");
  assert.equal(done.winnerCampaignId, "cmp-A");
  assert.ok(done.pValue !== null && done.pValue <= 0.05);
});

test("AudienceSplitTestService returns inconclusive when under-powered", () => {
  const svc = new AudienceSplitTestService();
  const rec = svc.createTest({
    segmentId: "seg-2",
    metric: "ctr",
    minSampleSize: 500,
    variants: [
      { campaignId: "c1", advertiserId: "a1" },
      { campaignId: "c2", advertiserId: "a2" }
    ]
  });
  svc.recordVariantActivity(rec.id, "c1", { impressions: 40, conversions: 4 });
  svc.recordVariantActivity(rec.id, "c2", { impressions: 40, conversions: 3 });
  const done = svc.finalize(rec.id);
  assert.equal(done.status, "inconclusive");
  assert.equal(done.winnerCampaignId, null);
});

test("AudienceSplitTestService rejects identical campaign variants", () => {
  const svc = new AudienceSplitTestService();
  assert.throws(() =>
    svc.createTest({
      segmentId: "seg-x",
      metric: "ctr",
      variants: [
        { campaignId: "same", advertiserId: "a" },
        { campaignId: "same", advertiserId: "b" }
      ]
    })
  );
});

test("twoTailedPValue returns ~0.05 for z≈1.96 and ~1 for z=0", () => {
  assert.ok(Math.abs(twoTailedPValue(1.96) - 0.05) < 0.01);
  assert.ok(twoTailedPValue(0) > 0.9);
});
