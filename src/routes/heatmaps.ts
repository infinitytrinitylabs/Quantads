import { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { withAuth } from "../middleware/auth";
import { attentionHeatmapService } from "../services/AttentionHeatmapService";

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

export const HeatmapSampleSchema = z.object({
  campaignId: z.string().min(1),
  creativeId: z.string().min(1),
  userId: z.string().min(1),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  weightMs: z.number().nonnegative(),
  occurredAt: z.string().datetime().optional()
});

export const HeatmapBatchSchema = z.object({
  samples: z.array(HeatmapSampleSchema).min(1).max(500)
});

export const handleHeatmapIngest = withAuth(async (req, res) => {
  const parsed = HeatmapBatchSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    sendJson(res, 422, {
      error: "Validation failed",
      details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
    });
    return;
  }

  for (const sample of parsed.data.samples) {
    attentionHeatmapService.ingest(sample);
  }
  sendJson(res, 201, { ingested: parsed.data.samples.length });
});

export const handleHeatmapGet = withAuth(async (req, res) => {
  const match = (req.url ?? "").match(/^\/api\/v1\/heatmaps\/([^/]+)\/([^/?]+)(\?.*)?$/);
  if (!match) {
    sendJson(res, 404, { error: "Heatmap not found" });
    return;
  }

  const campaignId = decodeURIComponent(match[1]);
  const creativeId = decodeURIComponent(match[2]);
  const grid = attentionHeatmapService.getGrid(campaignId, creativeId);
  if (!grid) {
    sendJson(res, 404, { error: "No heatmap data for the specified creative" });
    return;
  }
  sendJson(res, 200, grid);
});
