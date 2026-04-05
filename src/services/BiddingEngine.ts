export interface ContextualVector {
  platform: string;
  activityContext: string;
  moodSignals: {
    energyLevel?: number;
    curiosity?: number;
    purchaseIntent?: number;
  };
}

interface AudienceSignal {
  verifiedLtv: number;
  intentScore: number;
  conversionRate: number;
  recencyMultiplier?: number;
}

export interface ContextualAdCandidate {
  campaignId: string;
  advertiserId: string;
  title: string;
  adFormat: "contextual-story" | "product-placement" | "native-card";
  outcomeType: string;
  contextTags: string[];
  relevanceScore: number;
}

export interface PrivacyFirstBidResult {
  campaignId: string;
  adFormat: "contextual-story" | "product-placement" | "native-card";
  bidPrice: number;
  relevanceScore: number;
  sponsoredContent: {
    headline: string;
    body: string;
    ctaLabel: string;
    ctaUrl: string;
  };
  piiUsed: false;
}

// In-memory campaign registry (replaced by Prisma in production)
const CAMPAIGN_REGISTRY: ContextualAdCandidate[] = [
  {
    campaignId: "cmp-travel-gear-001",
    advertiserId: "adv-adventure-co",
    title: "Adventure Travel Gear",
    adFormat: "product-placement",
    outcomeType: "purchase",
    contextTags: ["travel", "adventure", "vlog", "outdoor", "explore"]
  } as ContextualAdCandidate & { relevanceScore: 0 },
  {
    campaignId: "cmp-creative-tools-001",
    advertiserId: "adv-create-studio",
    title: "AI Creative Suite",
    adFormat: "native-card",
    outcomeType: "app-install",
    contextTags: ["editing", "video", "cyberpunk", "design", "creative", "effects"]
  } as ContextualAdCandidate & { relevanceScore: 0 },
  {
    campaignId: "cmp-chill-sounds-001",
    advertiserId: "adv-sound-lab",
    title: "Lo-Fi Sound Pack",
    adFormat: "contextual-story",
    outcomeType: "purchase",
    contextTags: ["music", "chill", "lofi", "relax", "ambient", "beats"]
  } as ContextualAdCandidate & { relevanceScore: 0 },
  {
    campaignId: "cmp-coffee-001",
    advertiserId: "adv-roast-co",
    title: "Premium Coffee Roasters",
    adFormat: "native-card",
    outcomeType: "purchase",
    contextTags: ["morning", "productivity", "work", "focus", "coffee"]
  } as ContextualAdCandidate & { relevanceScore: 0 }
];

const SPONSORED_CONTENT: Record<string, PrivacyFirstBidResult["sponsoredContent"]> = {
  "cmp-travel-gear-001": {
    headline: "Pack Light, Travel Far",
    body: "Ultra-compact travel gear designed for the modern explorer.",
    ctaLabel: "Shop Now",
    ctaUrl: "https://adventure-co.example/gear"
  },
  "cmp-creative-tools-001": {
    headline: "Create Without Limits",
    body: "AI-powered editing tools that match your creative vision.",
    ctaLabel: "Get the App",
    ctaUrl: "https://create-studio.example/app"
  },
  "cmp-chill-sounds-001": {
    headline: "Set the Perfect Vibe",
    body: "Curated lo-fi sound packs to keep you in the zone.",
    ctaLabel: "Listen Free",
    ctaUrl: "https://sound-lab.example/lofi"
  },
  "cmp-coffee-001": {
    headline: "Fuel Your Flow State",
    body: "Single-origin specialty coffee, delivered to your door.",
    ctaLabel: "Order Now",
    ctaUrl: "https://roast-co.example/shop"
  }
};

/** Scores a campaign against a contextual vector without using any PII.
 *  Matching is purely semantic – only the activity context and mood signals are used. */
function scoreCandidate(
  candidate: ContextualAdCandidate,
  vector: ContextualVector
): number {
  const activityWords = vector.activityContext.toLowerCase().split(/\W+/);
  const tagMatches = candidate.contextTags.filter((tag) =>
    activityWords.some((word) => word.includes(tag) || tag.includes(word))
  ).length;

  const tagScore = tagMatches / Math.max(candidate.contextTags.length, 1);

  // Platform affinity bonus
  const platformBonus = getPlatformBonus(candidate.campaignId, vector.platform);

  // Mood multiplier (purchaseIntent boosts bid value, not PII)
  const moodBoost = vector.moodSignals.purchaseIntent ?? 0.5;

  return Number(((tagScore * 0.6 + platformBonus * 0.2 + moodBoost * 0.2)).toFixed(4));
}

function getPlatformBonus(campaignId: string, platform: string): number {
  const affinities: Record<string, string[]> = {
    "cmp-travel-gear-001": ["quanttube", "quantbrowse"],
    "cmp-creative-tools-001": ["quantedits", "quanttube"],
    "cmp-chill-sounds-001": ["quantchill", "quanttube"],
    "cmp-coffee-001": ["quantmail", "quantchat"]
  };

  return (affinities[campaignId] ?? []).includes(platform) ? 1 : 0;
}

/** Converts a contextual relevance score into an audience signal for the BiddingEngine. */
function toAudienceSignal(relevanceScore: number, vector: ContextualVector): AudienceSignal {
  return {
    verifiedLtv: 50 + relevanceScore * 150,   // estimated LTV range $50–$200
    intentScore: vector.moodSignals.purchaseIntent ?? 0.5,
    conversionRate: relevanceScore * 0.4,
    recencyMultiplier: 1
  };
}

/**
 * Selects and ranks contextual ad candidates for a given vector.
 * PII never enters this function – only the activity context and mood signals.
 */
export function selectContextualAds(
  vector: ContextualVector,
  maxAds: number,
  allowedFormats?: Array<"contextual-story" | "product-placement" | "native-card">
): PrivacyFirstBidResult[] {
  const scored = CAMPAIGN_REGISTRY
    .filter((c) => !allowedFormats || allowedFormats.includes(c.adFormat))
    .map((candidate) => ({ ...candidate, relevanceScore: scoreCandidate(candidate, vector) }))
    .filter((c) => c.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, maxAds);

  return scored.map((candidate) => {
    const signal = toAudienceSignal(candidate.relevanceScore, vector);
    const bidPrice = Number(
      (signal.verifiedLtv * signal.intentScore * candidate.relevanceScore).toFixed(2)
    );

    return {
      campaignId: candidate.campaignId,
      adFormat: candidate.adFormat,
      bidPrice,
      relevanceScore: candidate.relevanceScore,
      sponsoredContent: SPONSORED_CONTENT[candidate.campaignId] ?? {
        headline: candidate.title,
        body: "",
        ctaLabel: "Learn More",
        ctaUrl: "#"
      },
      piiUsed: false as const
    };
  });
}
