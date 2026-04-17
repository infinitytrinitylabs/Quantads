import test from "node:test";
import assert from "node:assert/strict";
import {
  AuctionTickerService,
  bucketAmount
} from "../src/services/AuctionTickerService";

test("AuctionTickerService pseudonymizes advertiser IDs consistently within a rotation", () => {
  const svc = new AuctionTickerService({
    salt: "t",
    rotationMs: 24 * 60 * 60 * 1000
  });
  const at = new Date("2026-04-17T12:00:00Z");
  const a = svc.publish({ advertiserId: "brand-acme", category: "Gaming", amount: 4.53, occurredAt: at.toISOString() });
  const b = svc.publish({ advertiserId: "brand-acme", category: "gaming", amount: 5, occurredAt: at.toISOString() });
  const c = svc.publish({ advertiserId: "brand-zeta", category: "gaming", amount: 5, occurredAt: at.toISOString() });

  assert.ok(a);
  assert.ok(b);
  assert.ok(c);
  assert.equal(a.advertiserHandle, b.advertiserHandle, "same advertiser → same handle");
  assert.notEqual(a.advertiserHandle, c.advertiserHandle, "distinct advertisers → distinct handles");
  assert.ok(a.advertiserHandle.startsWith("adv_"));
  assert.ok(a.advertiserHandle.length >= 10);
});

test("AuctionTickerService honours advertiser opt-out and never leaks the raw ID", () => {
  const svc = new AuctionTickerService({ salt: "t" });
  svc.optOut("brand-private");
  const ev = svc.publish({ advertiserId: "brand-private", category: "travel", amount: 2.5 });
  assert.equal(ev, null);

  svc.optIn("brand-private");
  const ev2 = svc.publish({ advertiserId: "brand-private", category: "travel", amount: 2.5 });
  assert.ok(ev2);
  assert.ok(!JSON.stringify(ev2).includes("brand-private"));
});

test("AuctionTickerService buckets amounts to $0.10", () => {
  assert.equal(bucketAmount(4.53), 4.5);
  assert.equal(bucketAmount(4.56), 4.6);
  assert.equal(bucketAmount(0.01), 0);
});

test("AuctionTickerService rate-limits and tracks suppressed count", () => {
  const svc = new AuctionTickerService({ salt: "t" });
  for (let i = 0; i < 100; i++) {
    svc.publish({ advertiserId: "brand-flood", category: "gaming", amount: 1 });
  }
  const snap = svc.snapshot(10);
  assert.ok(snap.suppressedCount > 0, "some events were suppressed");
  assert.ok(snap.events.length <= 10);
});
