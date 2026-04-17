import test from "node:test";
import assert from "node:assert/strict";
import { AttentionHeatmapService } from "../src/services/AttentionHeatmapService";
import { CompetitorMarketIntelService, percentile } from "../src/services/CompetitorMarketIntelService";
import { PerformanceStreakService } from "../src/services/PerformanceStreakService";

test("AttentionHeatmapService enforces k-anonymity on distinct-user threshold", () => {
  const svc = new AttentionHeatmapService({ kThreshold: 5 });

  // Only 3 distinct users → below threshold
  for (const uid of ["u1", "u2", "u3"]) {
    svc.ingest({ campaignId: "c", creativeId: "cr", userId: uid, x: 0.5, y: 0.5, weightMs: 100 });
  }
  const below = svc.getGrid("c", "cr");
  assert.ok(below);
  assert.equal(below.cells.length, 0);
  assert.equal(below.distinctUsers, 3);

  // Add more users to meet threshold
  for (const uid of ["u4", "u5", "u6", "u7"]) {
    svc.ingest({ campaignId: "c", creativeId: "cr", userId: uid, x: 0.5, y: 0.5, weightMs: 100 });
  }
  const above = svc.getGrid("c", "cr");
  assert.ok(above);
  assert.ok(above.cells.length > 0);
  assert.ok(above.cells.every((cell) => cell.uniqueUsers >= 5));
});

test("AttentionHeatmapService validates normalized coordinates", () => {
  const svc = new AttentionHeatmapService();
  assert.throws(() =>
    svc.ingest({ campaignId: "c", creativeId: "cr", userId: "u", x: 1.5, y: 0.5, weightMs: 10 })
  );
  assert.throws(() =>
    svc.ingest({ campaignId: "c", creativeId: "cr", userId: "u", x: 0.5, y: -0.1, weightMs: 10 })
  );
});

test("CompetitorMarketIntelService requires min 3 distinct competitors", () => {
  const svc = new CompetitorMarketIntelService();
  svc.ingest({ advertiserId: "a1", category: "gaming", dailyBudget: 100, date: "2026-04-17" });
  svc.ingest({ advertiserId: "a2", category: "gaming", dailyBudget: 200, date: "2026-04-17" });
  assert.equal(svc.getSnapshot("gaming"), null, "2 competitors → no disclosure");

  svc.ingest({ advertiserId: "a3", category: "gaming", dailyBudget: 300, cpm: 5, date: "2026-04-17" });
  const snap = svc.getSnapshot("gaming");
  assert.ok(snap);
  assert.equal(snap.competitorCount, 3);
  assert.ok(snap.dailyBudget.p50 > 0);
});

test("CompetitorMarketIntelService excludes the requester from its own snapshot", () => {
  const svc = new CompetitorMarketIntelService();
  ["a1", "a2", "a3", "a4"].forEach((id, i) =>
    svc.ingest({ advertiserId: id, category: "travel", dailyBudget: (i + 1) * 100, date: "2026-04-17" })
  );
  const snap = svc.getSnapshot("travel", "a1");
  assert.ok(snap);
  assert.equal(snap.competitorCount, 3);
});

test("percentile interpolates correctly", () => {
  assert.equal(percentile([10, 20, 30, 40], 50), 25);
  assert.equal(percentile([], 50), 0);
});

test("PerformanceStreakService counts consecutive profitable days only", () => {
  const svc = new PerformanceStreakService(1.0);
  svc.recordDay({ campaignId: "cmp-1", date: "2026-04-10", spend: 100, revenue: 150 });
  svc.recordDay({ campaignId: "cmp-1", date: "2026-04-11", spend: 100, revenue: 140 });
  // break in profitability
  svc.recordDay({ campaignId: "cmp-1", date: "2026-04-12", spend: 100, revenue: 90 });
  svc.recordDay({ campaignId: "cmp-1", date: "2026-04-13", spend: 100, revenue: 200 });
  svc.recordDay({ campaignId: "cmp-1", date: "2026-04-14", spend: 100, revenue: 200 });

  const streak = svc.getStreak("cmp-1");
  assert.ok(streak);
  assert.equal(streak.currentStreakDays, 2);
  assert.equal(streak.longestStreakDays, 2);
});

test("PerformanceStreakService handles gaps (non-consecutive dates reset streak)", () => {
  const svc = new PerformanceStreakService(1.0);
  svc.recordDay({ campaignId: "c", date: "2026-04-10", spend: 100, revenue: 150 });
  // skip 2026-04-11
  svc.recordDay({ campaignId: "c", date: "2026-04-12", spend: 100, revenue: 150 });
  const streak = svc.getStreak("c");
  assert.ok(streak);
  assert.equal(streak.currentStreakDays, 1);
});
