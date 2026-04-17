import { z } from "zod";

const SUPPORTED_SETTLEMENT_CURRENCIES = new Set([
  "USDC",
  "USDT",
  "DAI",
  "ETH",
  "WETH",
  "BTC",
  "WBTC"
]);

const SettlementCurrencySchema = z
  .string()
  .regex(/^[a-zA-Z]{3,5}$/, "currency must be 3-5 alphabetic characters")
  .transform((value) => value.toUpperCase())
  .refine(
    (value) => SUPPORTED_SETTLEMENT_CURRENCIES.has(value),
    "currency must be a supported stablecoin or crypto settlement asset"
  );

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

export const AuctionBidRequestSchema = z.object({
  advertiserId: z.string().min(1),
  agencyId: z.string().min(1),
  outcomeType: z.string().min(1),
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
  riskTolerance: z.number().min(0).max(1).optional(),
  outcomeCount: z.number().int().positive(),
  settlementAddress: z.string().min(1),
  settlementNetwork: z.string().min(1),
  currency: SettlementCurrencySchema.optional(),
  reservePrice: z.number().positive().optional(),
  priorityBoost: z.number().positive().optional(),
  expectedRevenuePerOutcome: z.number().positive().optional(),
  authorization: z
    .object({
      payerWallet: z.string().min(1),
      transactionHash: z.string().min(1),
      amount: z.number().positive(),
      currency: SettlementCurrencySchema
    })
    .optional()
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
  currency: SettlementCurrencySchema.optional()
});

export const OutcomeReportRequestSchema = z.object({
  invoiceId: z.string().min(1),
  outcomeType: z.string().min(1),
  outcomeCount: z.number().int().positive(),
  valueGenerated: z.number().positive(),
  verifier: z.string().min(1),
  transactionHash: z.string().min(1),
  occurredAt: z.string().datetime().optional()
});

// ── BCI Attention Signal ──────────────────────────────────────────────────────

export const BciAttentionSignalSchema = z.object({
  userId: z.string().min(1),
  sessionId: z.string().min(1),
  platform: z.enum(["quanttube", "quantedits", "quantchill", "quantchat", "quantmail", "quantbrowse"]),
  campaignId: z.string().min(1).optional(),
  attentionScore: z.number().min(0).max(1),
  engagementScore: z.number().min(0).max(1),
  focusScore: z.number().min(0).max(1),
  adExposureMs: z.number().int().nonnegative().optional(),
  occurredAt: z.string().datetime().optional()
});

export type BciAttentionSignalInput = z.infer<typeof BciAttentionSignalSchema>;

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

// ── Campaign Management ───────────────────────────────────────────────────────

export const CampaignTargetingRulesSchema = z.object({
  ageMin: z.number().int().min(0).max(120).optional(),
  ageMax: z.number().int().min(0).max(120).optional(),
  interests: z.array(z.string().min(1)).optional(),
  attentionThreshold: z.number().min(0).max(1).optional(),
  geoRadius: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    radiusMeters: z.number().positive()
  }).optional()
}).optional().default({});

export const CreativeInputSchema = z.object({
  url: z.string().url(),
  format: z.enum(["banner", "video", "native"]),
  previewUrl: z.string().url().optional()
});

export const CampaignCreateRequestSchema = z.object({
  name: z.string().min(1).max(256),
  budget: z.number().positive(),
  targetingRules: CampaignTargetingRulesSchema,
  creatives: z.array(CreativeInputSchema).optional().default([])
});

export const CampaignUpdateRequestSchema = z.object({
  name: z.string().min(1).max(256).optional(),
  budget: z.number().positive().optional(),
  status: z.enum(["active", "paused"]).optional(),
  targetingRules: CampaignTargetingRulesSchema
});

// ── Bid Processing ────────────────────────────────────────────────────────────

export const BidRequestSchema = z.object({
  campaignId: z.string().min(1),
  targetUserId: z.string().min(1),
  baseCpc: z.number().positive(),
  creativeId: z.string().min(1),
  advertiserBudget: z.number().positive(),
  attentionScore: z.number().min(0).max(1).optional()
});

// ── Tracking ──────────────────────────────────────────────────────────────────

export const ImpressionInputSchema = z.object({
  adId: z.string().min(1),
  userId: z.string().min(1),
  attentionScore: z.number().min(0).max(1),
  dwellTimeMs: z.number().int().nonnegative()
});

export const ClickInputSchema = z.object({
  adId: z.string().min(1),
  userId: z.string().min(1),
  timestamp: z.string().datetime().optional()
});
