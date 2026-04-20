/**
 * Smart Ads routes
 *
 * POST /api/v1/smart-ads/render
 *   Accept a user's attention/emotion signals and return a composed ad creative.
 *
 * POST /api/v1/smart-ads/emotion
 *   Ingest a behavioural sample and return the latest emotion estimate.
 *
 * GET  /api/v1/smart-ads/preview
 *   Return an advertiser preview page showing the creative at three attention
 *   levels.  Query params: campaignId, format, deviceType, localHour,
 *   emotionalState.
 *
 * POST /api/v1/smart-ads/ab/impression
 *   Record an A/B impression for analytics.
 *
 * POST /api/v1/smart-ads/ab/click
 *   Record an A/B click for analytics.
 *
 * GET  /api/v1/smart-ads/ab/metrics
 *   Return A/B metrics for a placement.
 */

import { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { withAuth } from "../middleware/auth";
import { logger } from "../lib/logger";
import { AdaptiveCreativeEngine, AdaptiveCreativeInput } from "../services/AdaptiveCreativeEngine";
import { CreativeComposer, AdFormat, AD_DIMENSIONS } from "../services/CreativeComposer";
import { EmotionDetector } from "../services/EmotionDetector";
import { FocusAggregator, FocusSnapshot } from "../services/FocusAggregator";
import { FormatShifter, DeliveryPlan } from "../services/FormatShifter";
import { AdRewardsUI } from "../components/AdRewardsUI";
import { SmartAdRenderer } from "../components/SmartAdRenderer";

// ─── Singleton service instances ──────────────────────────────────────────────

const engine = new AdaptiveCreativeEngine();
// One EmotionDetector per route module — suitable for server-side testing.
// In production each user session would maintain its own detector instance.
const detector = new EmotionDetector({ updateIntervalMs: 5_000 });
const composer = new CreativeComposer();
const renderer = new SmartAdRenderer();
const focusAggregator = new FocusAggregator();
const formatShifter = new FormatShifter();
const adRewardsUI = new AdRewardsUI();

// ─── Validation schemas ───────────────────────────────────────────────────────

const VALID_FORMATS: AdFormat[] = [
  "banner-mobile",
  "banner-leaderboard",
  "interstitial",
  "native",
  "video-preroll"
];

const FocusTelemetrySchema = z.object({
  scrollPauseMs: z.number().min(0),
  interactionCount: z.number().int().min(0),
  sampleWindowMs: z.number().int().positive().max(60_000).optional(),
  skipCount: z.number().int().min(0).optional(),
  skipRate: z.number().min(0).max(1).optional()
});

const RewardProgressSchema = z.object({
  points: z.number().min(0),
  unskippedViews: z.number().int().min(0),
  streakDays: z.number().int().min(0),
  nextRewardAt: z.number().int().min(1)
});

const RenderRequestSchema = z.object({
  campaignId: z.string().min(1).max(128),
  attentionScore: z.number().min(0).max(1),
  emotionalState: z.enum(["happy", "neutral", "bored", "frustrated"]),
  context: z.string().min(1).max(512),
  deviceType: z.enum(["mobile", "tablet", "desktop"]),
  localHour: z.number().int().min(0).max(23),
  format: z.enum(["banner-mobile", "banner-leaderboard", "interstitial", "native", "video-preroll"]),
  audienceLtv: z.number().min(0).optional(),
  transition: z.enum(["fade", "slide-up", "slide-left", "none"]).optional(),
  showTransparencyButton: z.boolean().optional(),
  dynamicDelivery: z.boolean().optional(),
  focusTelemetry: FocusTelemetrySchema.optional(),
  rewardProgress: RewardProgressSchema.optional()
});

const EmotionIngestSchema = z.object({
  scrollDeltaPx: z.number(),
  elapsedMs: z.number().min(0),
  clickCount: z.number().int().min(0),
  clickJitterMs: z.number().min(0),
  dwellTimeSeconds: z.number().min(0),
  idleSeconds: z.number().min(0)
});

const AbEventSchema = z.object({
  placementId: z.string().min(1).max(128),
  variantId: z.string().min(1).max(256)
});

const PREVIEW_DEFAULTS = {
  format: "native" as AdFormat,
  deviceType: "desktop" as AdaptiveCreativeInput["deviceType"],
  emotionalState: "neutral" as AdaptiveCreativeInput["emotionalState"],
  localHour: new Date().getHours(),
  campaignId: "preview-campaign"
};

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};

const sendHtml = (res: ServerResponse, status: number, html: string): void => {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
};

const readJson = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
};

function parseQs(url: string): Record<string, string> {
  const idx = url.indexOf("?");
  if (idx < 0) return {};
  const params: Record<string, string> = {};
  for (const pair of url.slice(idx + 1).split("&")) {
    const [key, value] = pair.split("=");
    if (key) params[decodeURIComponent(key)] = decodeURIComponent(value ?? "");
  }
  return params;
}

/**
 * Maps the requested format to a delivery-safe format for the selected mode.
 * Micro-burst mode biases to short banner formats; narrative mode upgrades
 * constrained banners to native for richer storytelling surface area.
 */
function mapFormatToDeliveryMode(requestedFormat: AdFormat, mode: "narrative-longform" | "micro-burst"): AdFormat {
  if (mode === "micro-burst") {
    return requestedFormat === "banner-leaderboard" ? "banner-leaderboard" : "banner-mobile";
  }
  if (requestedFormat === "banner-mobile" || requestedFormat === "banner-leaderboard") {
    return "native";
  }
  return requestedFormat;
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/smart-ads/render
 *
 * Accepts user signals and returns a composed, ready-to-render ad creative.
 */
export const handleSmartAdRender = withAuth(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const raw = await readJson(req);
    const parsed = RenderRequestSchema.safeParse(raw);
    if (!parsed.success) {
      const details = parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`);
      sendJson(res, 422, { error: "Validation failed", details });
      return;
    }

    const data = parsed.data;
    let activeFormat: AdFormat = data.format;
    let focusSnapshot: FocusSnapshot | undefined;
    let deliveryPlan: DeliveryPlan | undefined;

    if (data.dynamicDelivery) {
      focusSnapshot = data.focusTelemetry
        ? focusAggregator.ingest({
          scrollPauseMs: data.focusTelemetry.scrollPauseMs,
          interactionCount: data.focusTelemetry.interactionCount,
          sampleWindowMs: data.focusTelemetry.sampleWindowMs
        })
        : focusAggregator.snapshotFromAttentionScore(data.attentionScore);
      deliveryPlan = formatShifter.selectDelivery({
        attentionDepthScore: focusSnapshot.attentionDepthScore,
        skipRate: data.focusTelemetry?.skipRate
      });
      activeFormat = mapFormatToDeliveryMode(data.format, deliveryPlan.mode);
    }

    const input: AdaptiveCreativeInput = {
      campaignId: data.campaignId,
      attentionScore: data.attentionScore,
      emotionalState: data.emotionalState,
      context: data.context,
      deviceType: data.deviceType,
      localHour: data.localHour,
      audienceLtv: data.audienceLtv
    };

    const creativeResult = engine.selectVariant(input);
    const composed = composer.compose(creativeResult.variant, activeFormat);
    const emotionEstimate = detector.getLatestEstimate();
    const rewards = data.rewardProgress ? adRewardsUI.render(data.rewardProgress) : undefined;

    const rendered = renderer.render(
      composed,
      creativeResult.variant,
      {
        transition: data.transition ?? "fade",
        showTransparencyButton: data.showTransparencyButton ?? true
      },
      emotionEstimate
    );

    // Auto-register variant for A/B tracking
    try {
      composer.registerVariant(data.campaignId, creativeResult.variant.variantId);
    } catch {
      // Ignore registration errors when slot is full
    }
    composer.recordImpression(data.campaignId, creativeResult.variant.variantId);

    sendJson(res, 200, {
      campaignId: data.campaignId,
      variantId: creativeResult.variant.variantId,
      format: composed.format,
      requestedFormat: data.format,
      dimensions: { width: composed.width, height: composed.height },
      animationClass: composed.animationClass,
      selectionRules: creativeResult.selectionRules,
      creative: {
        headline: creativeResult.variant.headline,
        subheadline: creativeResult.variant.subheadline,
        bodyText: creativeResult.variant.bodyText,
        ctaText: creativeResult.variant.ctaText,
        imageSlot: creativeResult.variant.imageSlot,
        colorScheme: creativeResult.variant.colorScheme,
        animationSpeed: creativeResult.variant.animationSpeed,
        backgroundColor: creativeResult.variant.backgroundColor,
        accentColor: creativeResult.variant.accentColor,
        textColor: creativeResult.variant.textColor
      },
      htmlPayload: rendered.html,
      inlineStyles: rendered.styles,
      inlineScripts: rendered.scripts,
      transparencyRationale: creativeResult.variant.targetingRationale,
      emotionEstimate: {
        state: emotionEstimate.state,
        attentionScore: emotionEstimate.attentionScore,
        confidence: emotionEstimate.confidence
      },
      attentionDepth: focusSnapshot,
      deliveryPlan,
      rewardsWidget: rewards,
      composedAt: composed.composedAt
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    logger.error({ err: message }, "smart-ads render error");
    sendJson(res, 500, { error: message });
  }
});

/**
 * POST /api/v1/smart-ads/emotion
 *
 * Ingest a behavioural sample and return the updated emotion estimate.
 * No authentication required — this endpoint accepts anonymous signals.
 */
export async function handleEmotionIngest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const raw = await readJson(req);
    const parsed = EmotionIngestSchema.safeParse(raw);
    if (!parsed.success) {
      const details = parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`);
      sendJson(res, 422, { error: "Validation failed", details });
      return;
    }

    detector.ingestRaw(parsed.data);
    const estimate = detector.computeNow();

    sendJson(res, 200, {
      state: estimate.state,
      attentionScore: estimate.attentionScore,
      confidence: estimate.confidence,
      computedAt: estimate.computedAt,
      features: estimate.features
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    logger.error({ err: message }, "smart-ads emotion ingest error");
    sendJson(res, 500, { error: message });
  }
}

/**
 * GET /api/v1/smart-ads/preview
 *
 * Returns an HTML preview page for an advertiser showing the creative at
 * three attention levels.
 */
export const handleSmartAdPreview = withAuth(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const qs = parseQs(req.url ?? "");
    const format = (VALID_FORMATS.includes(qs["format"] as AdFormat) ? qs["format"] : PREVIEW_DEFAULTS.format) as AdFormat;
    const campaignId = qs["campaignId"] || PREVIEW_DEFAULTS.campaignId;
    const deviceType = (["mobile", "tablet", "desktop"].includes(qs["deviceType"] ?? "")
      ? qs["deviceType"]
      : PREVIEW_DEFAULTS.deviceType) as AdaptiveCreativeInput["deviceType"];
    const emotionalState = (["happy", "neutral", "bored", "frustrated"].includes(qs["emotionalState"] ?? "")
      ? qs["emotionalState"]
      : PREVIEW_DEFAULTS.emotionalState) as AdaptiveCreativeInput["emotionalState"];
    const localHour = qs["localHour"] !== undefined
      ? Math.max(0, Math.min(23, Number(qs["localHour"])))
      : PREVIEW_DEFAULTS.localHour;
    const audienceLtv = qs["audienceLtv"] !== undefined ? Number(qs["audienceLtv"]) : undefined;

    const baseInput: Omit<AdaptiveCreativeInput, "attentionScore"> = {
      campaignId,
      emotionalState,
      context: "advertiser preview",
      deviceType,
      localHour,
      audienceLtv
    };

    const previewResults = engine.previewAllLevels(baseInput);

    const levels = {
      low: {
        result: previewResults.low,
        composed: composer.compose(previewResults.low.variant, format)
      },
      medium: {
        result: previewResults.medium,
        composed: composer.compose(previewResults.medium.variant, format)
      },
      high: {
        result: previewResults.high,
        composed: composer.compose(previewResults.high.variant, format)
      }
    };

    const bundle = renderer.renderAdvertiserPreview(levels, format);
    sendHtml(res, 200, bundle.previewHtml);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    logger.error({ err: message }, "smart-ads preview error");
    sendJson(res, 500, { error: message });
  }
});

/**
 * POST /api/v1/smart-ads/ab/impression
 */
export async function handleAbImpression(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const raw = await readJson(req);
    const parsed = AbEventSchema.safeParse(raw);
    if (!parsed.success) {
      sendJson(res, 422, { error: "Validation failed", details: parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`) });
      return;
    }
    composer.recordImpression(parsed.data.placementId, parsed.data.variantId);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : "Unexpected error" });
  }
}

/**
 * POST /api/v1/smart-ads/ab/click
 */
export async function handleAbClick(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  try {
    const raw = await readJson(req);
    const parsed = AbEventSchema.safeParse(raw);
    if (!parsed.success) {
      sendJson(res, 422, { error: "Validation failed", details: parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`) });
      return;
    }
    composer.recordClick(parsed.data.placementId, parsed.data.variantId);
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : "Unexpected error" });
  }
}

/**
 * GET /api/v1/smart-ads/ab/metrics?placementId=...
 */
export const handleAbMetrics = withAuth(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const qs = parseQs(req.url ?? "");
    const placementId = qs["placementId"];
    if (!placementId) {
      sendJson(res, 422, { error: "placementId query param is required" });
      return;
    }
    const metrics = composer.getAbMetrics(placementId);
    sendJson(res, 200, { placementId, metrics });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : "Unexpected error" });
  }
});

// ─── AD_DIMENSIONS re-export for use by server.ts ────────────────────────────
export { AD_DIMENSIONS };
