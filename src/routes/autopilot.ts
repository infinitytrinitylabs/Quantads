import { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { withAuth } from "../middleware/auth";
import { bidAutopilotService } from "../services/BidAutopilotService";

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

export const AutopilotCreateSchema = z.object({
  campaignId: z.string().min(1),
  advertiserId: z.string().min(1),
  startingBid: z.number().positive(),
  minBid: z.number().positive(),
  maxBid: z.number().positive(),
  dailyBudgetCap: z.number().positive(),
  maxAdjustmentPerStep: z.number().gt(0).max(1).optional()
});

export const AutopilotModeSchema = z.object({
  mode: z.enum(["recommend", "auto_apply", "paused"])
});

export const AutopilotEvaluateSchema = z.object({
  conversionRate: z.number().min(0).max(1),
  attentionScore: z.number().min(0).max(1),
  marketPressure: z.number().positive(),
  impressions: z.number().int().nonnegative(),
  projectedAdditionalSpend: z.number().nonnegative().optional()
});

export const handleAutopilotCreate = withAuth(async (req, res) => {
  const parsed = AutopilotCreateSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    sendJson(res, 422, {
      error: "Validation failed",
      details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
    });
    return;
  }
  try {
    sendJson(res, 201, bidAutopilotService.createPolicy(parsed.data));
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : "create failed" });
  }
});

export const handleAutopilotMode = withAuth(async (req, res) => {
  const id = extractId(req.url ?? "", /^\/api\/v1\/autopilot\/policies\/([^/]+)\/mode$/);
  if (!id) {
    sendJson(res, 404, { error: "Policy not found" });
    return;
  }
  const parsed = AutopilotModeSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    sendJson(res, 422, {
      error: "Validation failed",
      details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
    });
    return;
  }
  try {
    sendJson(res, 200, bidAutopilotService.setMode(id, parsed.data.mode));
  } catch (err) {
    sendJson(res, 404, { error: err instanceof Error ? err.message : "policy not found" });
  }
});

export const handleAutopilotEvaluate = withAuth(async (req, res) => {
  const id = extractId(req.url ?? "", /^\/api\/v1\/autopilot\/policies\/([^/]+)\/evaluate$/);
  if (!id) {
    sendJson(res, 404, { error: "Policy not found" });
    return;
  }
  const parsed = AutopilotEvaluateSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    sendJson(res, 422, {
      error: "Validation failed",
      details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
    });
    return;
  }
  try {
    sendJson(res, 200, bidAutopilotService.evaluate(id, parsed.data));
  } catch (err) {
    sendJson(res, 404, { error: err instanceof Error ? err.message : "policy not found" });
  }
});

export const handleAutopilotGet = withAuth(async (req, res) => {
  const id = extractId(req.url ?? "", /^\/api\/v1\/autopilot\/policies\/([^/]+)$/);
  if (!id) {
    sendJson(res, 404, { error: "Policy not found" });
    return;
  }
  const policy = bidAutopilotService.getPolicy(id);
  if (!policy) {
    sendJson(res, 404, { error: "Policy not found" });
    return;
  }
  sendJson(res, 200, policy);
});

export const handleAutopilotAudit = withAuth(async (req, res) => {
  const id = extractId(req.url ?? "", /^\/api\/v1\/autopilot\/policies\/([^/]+)\/audit$/);
  if (!id) {
    sendJson(res, 404, { error: "Policy not found" });
    return;
  }
  const policy = bidAutopilotService.getPolicy(id);
  if (!policy) {
    sendJson(res, 404, { error: "Policy not found" });
    return;
  }
  sendJson(res, 200, { policyId: id, entries: bidAutopilotService.getAudit(id) });
});

function extractId(url: string, pattern: RegExp): string | null {
  const match = url.match(pattern);
  return match ? decodeURIComponent(match[1]) : null;
}
