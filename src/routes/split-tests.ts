import { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { withAuth } from "../middleware/auth";
import { audienceSplitTestService } from "../services/AudienceSplitTestService";

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

export const SplitTestCreateSchema = z.object({
  segmentId: z.string().min(1),
  metric: z.enum(["roas", "ctr", "conversion_rate"]),
  minSampleSize: z.number().int().positive().optional(),
  alpha: z.number().gt(0).lt(1).optional(),
  variants: z
    .tuple([
      z.object({ campaignId: z.string().min(1), advertiserId: z.string().min(1) }),
      z.object({ campaignId: z.string().min(1), advertiserId: z.string().min(1) })
    ])
});

export const SplitTestActivitySchema = z.object({
  campaignId: z.string().min(1),
  impressions: z.number().int().nonnegative().optional(),
  conversions: z.number().int().nonnegative().optional(),
  spend: z.number().nonnegative().optional(),
  revenue: z.number().nonnegative().optional()
});

export const handleSplitTestCreate = withAuth(async (req, res) => {
  const parsed = SplitTestCreateSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    sendJson(res, 422, {
      error: "Validation failed",
      details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
    });
    return;
  }
  try {
    sendJson(res, 201, audienceSplitTestService.createTest(parsed.data));
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : "create failed" });
  }
});

export const handleSplitTestGet = withAuth(async (req, res) => {
  const id = extractId(req.url ?? "", /^\/api\/v1\/split-tests\/([^/]+)$/);
  if (!id) {
    sendJson(res, 404, { error: "Split test not found" });
    return;
  }
  const test = audienceSplitTestService.getTest(id);
  if (!test) {
    sendJson(res, 404, { error: "Split test not found" });
    return;
  }
  sendJson(res, 200, test);
});

export const handleSplitTestActivity = withAuth(async (req, res) => {
  const id = extractId(req.url ?? "", /^\/api\/v1\/split-tests\/([^/]+)\/activity$/);
  if (!id) {
    sendJson(res, 404, { error: "Split test not found" });
    return;
  }
  const parsed = SplitTestActivitySchema.safeParse(await readJson(req));
  if (!parsed.success) {
    sendJson(res, 422, {
      error: "Validation failed",
      details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
    });
    return;
  }
  try {
    sendJson(res, 200, audienceSplitTestService.recordVariantActivity(id, parsed.data.campaignId, parsed.data));
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : "activity failed" });
  }
});

export const handleSplitTestFinalize = withAuth(async (req, res) => {
  const id = extractId(req.url ?? "", /^\/api\/v1\/split-tests\/([^/]+)\/finalize$/);
  if (!id) {
    sendJson(res, 404, { error: "Split test not found" });
    return;
  }
  try {
    sendJson(res, 200, audienceSplitTestService.finalize(id));
  } catch (err) {
    sendJson(res, 400, { error: err instanceof Error ? err.message : "finalize failed" });
  }
});

function extractId(url: string, pattern: RegExp): string | null {
  const match = url.match(pattern);
  return match ? decodeURIComponent(match[1]) : null;
}
