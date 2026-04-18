import test from "node:test";
import assert from "node:assert/strict";
import { isValidElement } from "react";
import { EmotionDetector } from "../src/smartads/EmotionDetector";
import { AdaptiveCreativeEngine } from "../src/smartads/AdaptiveCreativeEngine";
import { CreativeComposer, RecordingCanvasContext } from "../src/smartads/CreativeComposer";
import { SmartAdRenderer, buildSmartAdRenderModel } from "../src/smartads/SmartAdRenderer";
import { SmartAdRequest } from "../src/smartads/types";

const makeRequest = (): SmartAdRequest => ({
  advertiserId: "adv-smart-001",
  campaignId: "cmp-smart-hero",
  userId: "smart-user-001",
  placement: {
    platform: "quantedits",
    adFormat: "display",
    width: 640,
    height: 360,
    density: 2,
    deviceCategory: "desktop",
    placementPath: "/editor/export-panel",
    viewabilityEstimate: 0.88,
    locale: "en-US",
    localHour: 14
  },
  audience: {
    verifiedLtv: 260,
    intentScore: 0.74,
    conversionRate: 0.31,
    attentionScore: 0.79,
    fatigueScore: 0.24,
    familiarityScore: 0.58,
    purchasePowerIndex: 0.68,
    recentWins: 2,
    recentLosses: 1,
    lastEmotion: "curious"
  },
  objectives: {
    primaryOutcome: "purchase",
    priority: "conversion",
    targetRoas: 2.4,
    budgetSensitivity: 0.42
  },
  product: {
    name: "Quantum Color Grade Pack",
    brandName: "Quantedits Pro",
    category: "creative-tools",
    price: 29,
    compareAtPrice: 49,
    currency: "USD",
    offerHeadline: "Upgrade your edits before the next export",
    offerBody: "Cinematic LUTs, motion presets, and one-click grade stacks for fast post-production.",
    destinationUrl: "https://quantads.example/creative-tools",
    imageUrl: "https://cdn.quantads.example/creative-tools.png",
    valueProps: ["60 LUTs", "Fast exports", "Creator workflow"],
    proofPoints: ["Used by verified editors", "4.9/5 creator rating", "Install in under 2 minutes"],
    badges: ["Best seller", "Creator tested"]
  },
  interaction: {
    focusDurationMs: 58_000,
    pointerEvents: 42,
    pointerSamples: [
      { dx: 4, dy: 2, dtMs: 12 },
      { dx: 8, dy: 1, dtMs: 16 },
      { dx: 6, dy: 3, dtMs: 14 }
    ],
    scrollDepth: 0.76,
    scrollSamples: [
      { offset: 220, velocity: 1.2, dwellMs: 1900 },
      { offset: 420, velocity: 0.8, dwellMs: 2200 },
      { offset: 640, velocity: 0.5, dwellMs: 2600 }
    ],
    keyEvents: 6,
    rageClicks: 0,
    copyPasteEvents: 1,
    hoverTargets: 4,
    formInteractions: 2,
    mediaPlayheadMs: 16_000
  },
  history: {
    recentImpressions: 4,
    recentClicks: 1,
    recentConversions: 1,
    priorAttentionDelta: 0.18,
    previousEmotion: "curious",
    dwellTrend: 0.22,
    averageScrollDepth: 0.67
  },
  environment: {
    contentGenre: "editing-tutorial",
    sessionDepth: 6,
    culturalMoment: "launch-week",
    soundtrackEnergy: 0.58
  }
});

test("EmotionDetector infers frustration from rage-heavy behavioral signals", () => {
  const detector = new EmotionDetector();
  const request = makeRequest();
  request.audience.intentScore = 0.12;
  request.audience.conversionRate = 0.06;
  request.audience.attentionScore = 0.08;
  request.audience.fatigueScore = 0.91;
  request.audience.familiarityScore = 0.12;
  request.interaction.focusDurationMs = 12_000;
  request.interaction.rageClicks = 6;
  request.interaction.copyPasteEvents = 5;
  request.interaction.scrollDepth = 0.12;
  request.interaction.hoverTargets = 0;
  request.interaction.formInteractions = 0;
  request.interaction.keyEvents = 0;
  request.interaction.mediaPlayheadMs = 0;
  request.history = {
    ...request.history,
    recentImpressions: 14,
    recentClicks: 0,
    recentConversions: 0,
    previousEmotion: "frustrated"
  };

  const emotion = detector.detect({
    interaction: request.interaction,
    audience: request.audience,
    history: request.history
  });

  assert.equal(emotion.primaryEmotion, "frustrated");
  assert.ok(emotion.confidence >= 0.3);
  assert.ok(emotion.signals.some((signal) => signal.id === "rage" && signal.normalized > 0.7));
  assert.equal(emotion.pacing, "calm");
});

test("AdaptiveCreativeEngine selects reassurance creative for skeptical audiences", () => {
  const request = makeRequest();
  request.audience.intentScore = 0.32;
  request.audience.conversionRate = 0.14;
  request.audience.attentionScore = 0.33;
  request.audience.fatigueScore = 0.52;
  request.audience.familiarityScore = 0.9;
  request.history = {
    ...request.history,
    previousEmotion: "skeptical",
    recentImpressions: 12
  };
  request.interaction.rageClicks = 0;
  request.interaction.copyPasteEvents = 3;
  request.interaction.formInteractions = 1;
  request.interaction.hoverTargets = 1;

  const engine = new AdaptiveCreativeEngine();
  const decision = engine.decide(request);

  assert.ok(["skeptical", "curious"].includes(decision.emotion.primaryEmotion));
  assert.match(decision.selected.name, /Reassurance|reassurance/i);
  assert.ok(decision.reasoning.some((reason) => reason.includes("selected")));
  assert.ok(decision.rankedOptions.length >= 4);
  assert.match(decision.creativeStrategy.ctaLabel, /details/i);
});

test("CreativeComposer builds layered canvas output with deterministic operations", () => {
  const request = makeRequest();
  const engine = new AdaptiveCreativeEngine();
  const decision = engine.decide(request);
  const composer = new CreativeComposer();
  const canvas = new RecordingCanvasContext(request.placement.width, request.placement.height);

  const composition = composer.compose(canvas, request, decision);

  assert.equal(composition.width, 640);
  assert.equal(composition.height, 360);
  assert.ok(composition.layers.length >= 10);
  assert.ok(composition.metrics.headlineLines >= 1);
  assert.ok(composition.metrics.ctaProminence > 0);
  assert.ok(composition.operationLog.some((entry) => entry.startsWith("gradient:")));
  assert.ok(composition.operationLog.some((entry) => entry.startsWith("fillText:")));
  assert.match(composition.altText, /Quantedits Pro/);
});

test("SmartAdRenderer returns a valid React element and stable render model", () => {
  const request = makeRequest();
  const engine = new AdaptiveCreativeEngine();
  const decision = engine.decide(request);
  const composer = new CreativeComposer();
  const canvas = new RecordingCanvasContext(request.placement.width, request.placement.height);
  const composition = composer.compose(canvas, request, decision);

  const element = SmartAdRenderer({ request, decision, composition });
  const model = buildSmartAdRenderModel({ request, decision, composition });

  assert.ok(isValidElement(element));
  assert.equal(element.type, "section");
  assert.equal(model.headline, composition.headline);
  assert.equal(model.ctaLabel, composition.ctaLabel);
  assert.equal(model.metrics.length, 4);
  assert.ok(model.badges.length >= 2);
  assert.match(model.accessibility.ariaLabel, /adaptive smart ad/i);
});
