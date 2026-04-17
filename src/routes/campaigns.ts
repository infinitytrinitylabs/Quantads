/**
 * Campaign Management API routes
 *
 * POST   /api/v1/campaigns              – create campaign (auth required)
 * GET    /api/v1/campaigns              – list campaigns for authenticated advertiser
 * PATCH  /api/v1/campaigns/:id          – update budget/status/targeting
 * DELETE /api/v1/campaigns/:id          – soft-delete
 * GET    /api/v1/campaigns/:id/analytics – impressions, clicks, spend, CTR, eCPM, attention
 */

import { IncomingMessage, ServerResponse } from "node:http";
import { withAuth } from "../middleware/auth";
import { campaignStore } from "../campaigns/CampaignStore";
import { CampaignCreateRequestSchema, CampaignUpdateRequestSchema } from "../lib/validation";
import { logger } from "../lib/logger";

// ── Shared helpers ─────────────────────────────────────────────────────────────

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

const readJson = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
};

// ── Route matchers ─────────────────────────────────────────────────────────────

function parseCampaignId(url: string | undefined): string | null {
  const m = url?.match(/^\/api\/v1\/campaigns\/([^/]+)(?:\/analytics)?$/);
  return m ? decodeURIComponent(m[1]) : null;
}

function isAnalyticsRoute(url: string | undefined): boolean {
  return /^\/api\/v1\/campaigns\/[^/]+\/analytics$/.test(url ?? "");
}

// ── POST /api/v1/campaigns ────────────────────────────────────────────────────

export const handleCreateCampaign = withAuth(async (req: IncomingMessage, res: ServerResponse, token) => {
  const raw = await readJson(req);
  const parsed = CampaignCreateRequestSchema.safeParse(raw);

  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    logger.warn({ errors }, "campaign create validation failed");
    sendJson(res, 422, { error: "Validation failed", details: errors });
    return;
  }

  const campaign = campaignStore.create(token.sub, parsed.data);
  logger.info({ campaignId: campaign.id, advertiserId: token.sub }, "campaign created");
  sendJson(res, 201, campaign);
});

// ── GET /api/v1/campaigns ─────────────────────────────────────────────────────

export const handleListCampaigns = withAuth(async (_req: IncomingMessage, res: ServerResponse, token) => {
  const campaigns = campaignStore.listForAdvertiser(token.sub);
  sendJson(res, 200, { campaigns, total: campaigns.length });
});

// ── PATCH /api/v1/campaigns/:id ───────────────────────────────────────────────

export const handleUpdateCampaign = withAuth(async (req: IncomingMessage, res: ServerResponse, token) => {
  const campaignId = parseCampaignId(req.url);
  if (!campaignId) {
    sendJson(res, 404, { error: "Campaign not found" });
    return;
  }

  const raw = await readJson(req);
  const parsed = CampaignUpdateRequestSchema.safeParse(raw);

  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    sendJson(res, 422, { error: "Validation failed", details: errors });
    return;
  }

  const updated = campaignStore.update(campaignId, token.sub, parsed.data);
  if (!updated) {
    sendJson(res, 404, { error: "Campaign not found or access denied" });
    return;
  }

  logger.info({ campaignId, advertiserId: token.sub }, "campaign updated");
  sendJson(res, 200, updated);
});

// ── DELETE /api/v1/campaigns/:id ──────────────────────────────────────────────

export const handleDeleteCampaign = withAuth(async (req: IncomingMessage, res: ServerResponse, token) => {
  const campaignId = parseCampaignId(req.url);
  if (!campaignId) {
    sendJson(res, 404, { error: "Campaign not found" });
    return;
  }

  const deleted = campaignStore.delete(campaignId, token.sub);
  if (!deleted) {
    sendJson(res, 404, { error: "Campaign not found or access denied" });
    return;
  }

  logger.info({ campaignId, advertiserId: token.sub }, "campaign deleted");
  sendJson(res, 200, { deleted: true, campaignId });
});

// ── GET /api/v1/campaigns/:id/analytics ──────────────────────────────────────

export const handleCampaignAdAnalytics = withAuth(async (req: IncomingMessage, res: ServerResponse, token) => {
  const campaignId = parseCampaignId(req.url);
  if (!campaignId || !isAnalyticsRoute(req.url)) {
    sendJson(res, 404, { error: "Analytics route not found" });
    return;
  }

  const campaign = campaignStore.get(campaignId);
  if (!campaign || campaign.advertiserId !== token.sub) {
    sendJson(res, 404, { error: "Campaign not found or access denied" });
    return;
  }

  const analytics = campaignStore.getAnalytics(campaignId);
  if (!analytics) {
    sendJson(res, 404, { error: "Analytics not available" });
    return;
  }

  sendJson(res, 200, analytics);
});
