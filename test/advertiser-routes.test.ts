import test, { after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { sign } from "jsonwebtoken";
import { app } from "../src/server";

const JWT_SECRET = process.env["QUANTMAIL_JWT_SECRET"] ?? "dev-secret-change-in-production";

function makeToken(sub = "advertiser-svc-test"): string {
  return sign({ sub, iss: "quantmail" }, JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: 3600
  });
}

test("advertiser transparency endpoints are wired and JWT-gated", async () => {
  const server = app.listen(0);
  await once(server, "listening");
  after(() => server.close());

  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  const base = `http://127.0.0.1:${address.port}`;
  const auth = { "content-type": "application/json", authorization: `Bearer ${makeToken()}` };

  // JWT is required
  const unauth = await fetch(`${base}/api/v1/ticker/recent`);
  assert.equal(unauth.status, 401);

  // Publish → recent
  const pub = await fetch(`${base}/api/v1/ticker/publish`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ advertiserId: "brand-route", category: "gaming", amount: 4.2 })
  });
  assert.equal(pub.status, 201);
  const pubBody = (await pub.json()) as { event: { advertiserHandle: string } };
  assert.ok(pubBody.event.advertiserHandle.startsWith("adv_"));

  const recent = await fetch(`${base}/api/v1/ticker/recent?limit=5`, { headers: auth });
  assert.equal(recent.status, 200);

  // Split test lifecycle
  const create = await fetch(`${base}/api/v1/split-tests`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      segmentId: "seg-route",
      metric: "conversion_rate",
      minSampleSize: 10,
      alpha: 0.05,
      variants: [
        { campaignId: "cmp-r-A", advertiserId: "adv-A" },
        { campaignId: "cmp-r-B", advertiserId: "adv-B" }
      ]
    })
  });
  assert.equal(create.status, 201);
  const created = (await create.json()) as { id: string };

  await fetch(`${base}/api/v1/split-tests/${created.id}/activity`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ campaignId: "cmp-r-A", impressions: 500, conversions: 60 })
  });
  await fetch(`${base}/api/v1/split-tests/${created.id}/activity`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ campaignId: "cmp-r-B", impressions: 500, conversions: 30 })
  });
  const finalize = await fetch(`${base}/api/v1/split-tests/${created.id}/finalize`, {
    method: "POST",
    headers: auth
  });
  const finalized = (await finalize.json()) as { status: string; winnerCampaignId: string | null };
  assert.equal(finalized.status, "finalized");
  assert.equal(finalized.winnerCampaignId, "cmp-r-A");

  // Autopilot lifecycle
  const createPolicy = await fetch(`${base}/api/v1/autopilot/policies`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      campaignId: "c-route",
      advertiserId: "a-route",
      startingBid: 1,
      minBid: 0.5,
      maxBid: 2,
      dailyBudgetCap: 100
    })
  });
  assert.equal(createPolicy.status, 201);
  const policy = (await createPolicy.json()) as { id: string; mode: string };
  assert.equal(policy.mode, "recommend");

  const evalRes = await fetch(`${base}/api/v1/autopilot/policies/${policy.id}/evaluate`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ conversionRate: 0.8, attentionScore: 0.8, marketPressure: 1.1, impressions: 100 })
  });
  const evalBody = (await evalRes.json()) as { applied: boolean };
  assert.equal(evalBody.applied, false, "defaults to recommend — never auto-applies");

  const audit = await fetch(`${base}/api/v1/autopilot/policies/${policy.id}/audit`, { headers: auth });
  const auditBody = (await audit.json()) as { entries: unknown[] };
  assert.equal(auditBody.entries.length, 1);

  // Market intel: insufficient data returns 404
  const scan404 = await fetch(`${base}/api/v1/market-intel/empty-category`, { headers: auth });
  assert.equal(scan404.status, 404);
});
