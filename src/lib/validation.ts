import { z } from "zod";

// ── Contextual Ads ────────────────────────────────────────────────────────────

export const ContextualAdRequestSchema = z.object({
  platform: z.enum(["quanttube", "quantedits", "quantchill", "quantchat", "quantmail", "quantbrowse"]),
  activityContext: z.string().min(1).max(256),
  moodSignals: z.object({
    energyLevel: z.number().min(0).max(1).optional(),
    curiosity: z.number().min(0).max(1).optional(),
    purchaseIntent: z.number().min(0).max(1).optional()
  }).optional(),
  maxAds: z.number().int().min(1).max(10).optional().default(3),
  adFormats: z.array(z.enum(["contextual-story", "product-placement", "native-card"])).optional()
});

export type ContextualAdRequest = z.infer<typeof ContextualAdRequestSchema>;

// ── Analytics ─────────────────────────────────────────────────────────────────

export const AnalyticsQuerySchema = z.object({
  campaignId: z.string().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  granularity: z.enum(["hour", "day", "week"]).optional().default("day")
});

export type AnalyticsQuery = z.infer<typeof AnalyticsQuerySchema>;

// ── Outcome Bid ───────────────────────────────────────────────────────────────

export const OutcomeBidRequestSchema = z.object({
  baseOutcomePrice: z.number().positive(),
  audience: z.object({
    verifiedLtv: z.number().positive(),
    intentScore: z.number().min(0).max(1),
    conversionRate: z.number().min(0).max(1),
    recencyMultiplier: z.number().positive().optional()
  }),
  marketPressure: z.number().positive().optional(),
  floorPrice: z.number().positive().optional(),
  maxPrice: z.number().positive().optional(),
  riskTolerance: z.number().min(0).max(1).optional()
});

// ── x402 Payment ─────────────────────────────────────────────────────────────

export const OutcomePaymentRequestSchema = z.object({
  agencyId: z.string().min(1),
  campaignId: z.string().min(1),
  outcomeType: z.string().min(1),
  outcomeCount: z.number().int().positive(),
  unitPrice: z.number().positive(),
  settlementAddress: z.string().min(1),
  settlementNetwork: z.string().min(1),
  currency: z.string().length(3).toUpperCase().optional()
});

// ── Twin Simulation ───────────────────────────────────────────────────────────

export const CoordinateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180)
});

export const TwinSimulationRequestSchema = z.object({
  campaign: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    target: CoordinateSchema.extend({ radiusMeters: z.number().positive() }),
    notificationTitle: z.string().min(1),
    notificationBody: z.string().min(1),
    webglOverlay: z.object({
      sceneId: z.string().min(1),
      assetUrl: z.string().url(),
      shaderPreset: z.enum(["billboard", "portal", "lightfield"]),
      anchorMode: z.literal("world-locked"),
      ctaLabel: z.string().min(1)
    }),
    quantchatMultiplier: z.object({
      multiplier: z.number().positive(),
      claimWindowSeconds: z.number().int().positive()
    })
  }),
  audience: z.array(z.object({
    userId: z.string().min(1),
    route: z.array(CoordinateSchema).min(1),
    quantchatOpenDelaySeconds: z.number().nonnegative().optional()
  })).min(1)
});
