import { IncomingMessage, ServerResponse } from "node:http";
import { bciAttentionStore } from "../bci/AttentionStore";
import { withAuth } from "../middleware/auth";
import {
  SmartAdEmotionRequestSchema,
  SmartAdRenderRequestSchema,
  SmartAdSelectRequestSchema
} from "../lib/validation";
import { logger } from "../lib/logger";
import { AdaptiveCreativeEngine } from "../smartads/AdaptiveCreativeEngine";
import { CreativeComposer, RecordingCanvasContext } from "../smartads/CreativeComposer";
import { EmotionDetector } from "../smartads/EmotionDetector";
import { buildSmartAdRenderModel } from "../smartads/SmartAdRenderer";
import { SmartAdRequest } from "../smartads/types";

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

const emotionDetector = new EmotionDetector();
const creativeEngine = new AdaptiveCreativeEngine({ emotionDetector });
const composer = new CreativeComposer();

const toDetectionInput = (request: SmartAdRequest, fallbackUserId?: string) => ({
  interaction: request.interaction,
  audience: request.audience,
  history: request.history,
  bciMetrics: bciAttentionStore.getAggregated(request.userId ?? fallbackUserId ?? "")
});

const parsePayload = async <T>(
  req: IncomingMessage,
  res: ServerResponse,
  parser: { safeParse(input: unknown): { success: boolean; data?: T; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } } }
): Promise<T | null> => {
  const raw = await readJson(req);
  const parsed = parser.safeParse(raw);

  if (!parsed.success) {
    const details = (parsed.error?.issues ?? []).map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`);
    sendJson(res, 422, { error: "Validation failed", details });
    return null;
  }

  return parsed.data ?? null;
};

export const handleSmartAdEmotion = withAuth(async (req, res, token) => {
  const payload = await parsePayload(req, res, SmartAdEmotionRequestSchema);
  if (!payload) {
    return;
  }

  const request = payload as SmartAdRequest;
  const emotion = emotionDetector.detect(toDetectionInput(request, token.sub));
  logger.info({ campaignId: request.campaignId, advertiserId: request.advertiserId, emotion: emotion.primaryEmotion }, "smart ad emotion inferred");
  sendJson(res, 200, {
    emotion,
    meta: {
      engine: "quantads-emotion-v1",
      usedBciHistory: Boolean(request.userId ?? token.sub)
    }
  });
});

export const handleSmartAdSelect = withAuth(async (req, res, token) => {
  const payload = await parsePayload(req, res, SmartAdSelectRequestSchema);
  if (!payload) {
    return;
  }

  const request = payload as SmartAdRequest;
  const detectionInput = toDetectionInput(request, token.sub);
  const decision = creativeEngine.decide(request, detectionInput);
  logger.info(
    {
      campaignId: request.campaignId,
      advertiserId: request.advertiserId,
      creativeId: decision.selected.creativeId,
      emotion: decision.emotion.primaryEmotion
    },
    "smart ad creative selected"
  );
  sendJson(res, 200, {
    decision,
    meta: {
      engine: "quantads-adaptive-creative-v1",
      rankedCandidates: decision.rankedOptions.length
    }
  });
});

export const handleSmartAdRender = withAuth(async (req, res, token) => {
  const payload = await parsePayload(req, res, SmartAdRenderRequestSchema);
  if (!payload) {
    return;
  }

  const request = payload as SmartAdRequest;
  const detectionInput = toDetectionInput(request, token.sub);
  const decision = creativeEngine.decide(request, detectionInput);
  const recordingCanvas = new RecordingCanvasContext(request.placement.width, request.placement.height);
  const composition = composer.compose(recordingCanvas, request, decision);
  const renderModel = buildSmartAdRenderModel({ request, decision, composition });

  logger.info(
    {
      campaignId: request.campaignId,
      advertiserId: request.advertiserId,
      creativeId: decision.selected.creativeId,
      emotion: decision.emotion.primaryEmotion
    },
    "smart ad rendered"
  );

  sendJson(res, 200, {
    emotion: decision.emotion,
    decision,
    composition,
    renderModel,
    meta: {
      engine: "quantads-smart-renderer-v1",
      canvasOperations: composition.operationLog.length,
      hasBciHistory: Boolean(request.userId ?? token.sub)
    }
  });
});
