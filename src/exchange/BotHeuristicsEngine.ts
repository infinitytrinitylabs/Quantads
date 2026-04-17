import { ExchangeBidRequest, BotHeuristicsResult, FraudRuleSignal, TrafficQualityTier } from "./types";
import { average, boundedRatio, clamp, logistic, nowIso, round, standardDeviation } from "./math";

interface SessionWindowEntry {
  seenAt: number;
  requestId: string;
  userAgent: string;
  viewportWidth: number;
  viewportHeight: number;
  pointerEvents: number;
  focusDurationMs: number;
  scrollDepth: number;
  rageClicks: number;
}

interface FingerprintState {
  totalRequests: number;
  firstSeenAt: number;
  lastSeenAt: number;
  requestTimestamps: number[];
  sessionIds: Set<string>;
  userAgentHashes: Set<string>;
  campaigns: Set<string>;
}

interface DeviceHistory {
  requests: number;
  lastViewportWidths: number[];
  lastViewportHeights: number[];
  lastFocusDurations: number[];
  lastPointerCounts: number[];
  lastScrollDepths: number[];
}

const WINDOW_MS = 5 * 60 * 1000;
const HASH_SEED = 131;

const hashString = (value: string): string => {
  let hash = 0;
  for (const character of value) {
    hash = (hash * HASH_SEED + character.charCodeAt(0)) >>> 0;
  }
  return hash.toString(16);
};

const pushWindowValue = (values: number[], value: number, size = 24): void => {
  values.push(value);
  if (values.length > size) {
    values.shift();
  }
};

const trimTimestamps = (timestamps: number[], currentTime: number): number[] =>
  timestamps.filter((timestamp) => currentTime - timestamp <= WINDOW_MS);

export class BotHeuristicsEngine {
  private readonly fingerprints = new Map<string, FingerprintState>();
  private readonly devices = new Map<string, DeviceHistory>();
  private readonly sessions = new Map<string, SessionWindowEntry[]>();

  evaluate(request: ExchangeBidRequest): BotHeuristicsResult {
    const now = new Date(request.occurredAt ?? nowIso()).getTime();
    const requestId = request.requestId ?? `${request.placement.auctionId}:${request.creativeId}:${now}`;
    const fingerprintKey = `${request.fingerprint.ipHash}:${request.fingerprint.deviceIdHash ?? "anon"}`;
    const deviceKey = `${request.fingerprint.userAgent}:${request.placement.viewport.width}x${request.placement.viewport.height}`;

    const fingerprintState = this.getFingerprintState(fingerprintKey, now);
    const deviceHistory = this.getDeviceHistory(deviceKey);
    const sessionEvents = this.getSessionHistory(request.fingerprint.sessionId, now);

    const rules: FraudRuleSignal[] = [];
    this.applyVelocityRules(request, fingerprintState, sessionEvents, rules, now);
    this.applyDeviceRules(request, fingerprintState, deviceHistory, rules);
    this.applyEngagementRules(request, deviceHistory, sessionEvents, rules);
    this.applyTimingRules(request, fingerprintState, rules, now);
    this.applyNetworkRules(request, fingerprintState, rules);
    this.applySignatureRules(request, fingerprintState, sessionEvents, rules);

    const weightedScore = rules.reduce((total, rule) => total + rule.weight * rule.score, 0);
    const totalWeight = rules.reduce((total, rule) => total + rule.weight, 0) || 1;
    const normalized = clamp(weightedScore / totalWeight, 0, 1);
    const confidence = clamp(logistic((rules.length - 2) * 0.55) * (0.5 + normalized / 2), 0, 1);
    const suspected = normalized >= 0.52 || rules.some((rule) => rule.score >= 0.95 && rule.weight >= 1);
    const tier = this.resolveTier(normalized, suspected);

    this.recordRequest(request, fingerprintState, deviceHistory, sessionEvents, requestId, now);

    return {
      score: round(normalized, 6),
      confidence: round(confidence, 6),
      suspected,
      tier,
      reasons: rules.map((rule) => `${rule.label}: ${rule.reason}`),
      triggeredRules: rules,
      featureSnapshot: {
        requestId,
        fingerprintKey,
        sessionVelocityPerMinute: round(sessionEvents.length / 5, 6),
        ipVelocityPerMinute: round(fingerprintState.requestTimestamps.length / 5, 6),
        pointerEvents: request.interaction.pointerEvents,
        focusDurationMs: request.interaction.focusDurationMs,
        scrollDepth: request.interaction.scrollDepth,
        rageClicks: request.interaction.rageClicks,
        pageViewsInSession: request.fingerprint.pageViewsInSession ?? 0,
        localHour: request.fingerprint.localHour ?? null,
        userAgentHashCount: fingerprintState.userAgentHashes.size,
        campaignFanOut: fingerprintState.campaigns.size
      }
    };
  }

  private getFingerprintState(key: string, now: number): FingerprintState {
    const existing = this.fingerprints.get(key);
    if (existing) {
      existing.requestTimestamps = trimTimestamps(existing.requestTimestamps, now);
      existing.lastSeenAt = now;
      return existing;
    }

    const state: FingerprintState = {
      totalRequests: 0,
      firstSeenAt: now,
      lastSeenAt: now,
      requestTimestamps: [],
      sessionIds: new Set<string>(),
      userAgentHashes: new Set<string>(),
      campaigns: new Set<string>()
    };
    this.fingerprints.set(key, state);
    return state;
  }

  private getDeviceHistory(key: string): DeviceHistory {
    const existing = this.devices.get(key);
    if (existing) {
      return existing;
    }

    const history: DeviceHistory = {
      requests: 0,
      lastViewportWidths: [],
      lastViewportHeights: [],
      lastFocusDurations: [],
      lastPointerCounts: [],
      lastScrollDepths: []
    };
    this.devices.set(key, history);
    return history;
  }

  private getSessionHistory(sessionId: string, now: number): SessionWindowEntry[] {
    const history = (this.sessions.get(sessionId) ?? []).filter((entry) => now - entry.seenAt <= WINDOW_MS);
    this.sessions.set(sessionId, history);
    return history;
  }

  private applyVelocityRules(
    request: ExchangeBidRequest,
    fingerprintState: FingerprintState,
    sessionEvents: SessionWindowEntry[],
    rules: FraudRuleSignal[],
    now: number
  ): void {
    const ipVelocity = fingerprintState.requestTimestamps.length / 5;
    const sessionVelocity = sessionEvents.length / 5;
    const repeatedRapidFire = sessionEvents.filter((entry) => now - entry.seenAt < 1500).length;

    if (ipVelocity >= 18) {
      rules.push({
        id: "velocity.ip.burst",
        label: "IP burst velocity",
        weight: 1.3,
        score: clamp(ipVelocity / 35, 0, 1),
        reason: `Observed ${round(ipVelocity, 2)} requests per minute from one fingerprint window`,
        category: "velocity"
      });
    }

    if (sessionVelocity >= 8) {
      rules.push({
        id: "velocity.session.burst",
        label: "Session burst velocity",
        weight: 1.2,
        score: clamp(sessionVelocity / 16, 0, 1),
        reason: `Session produced ${round(sessionVelocity, 2)} exchange requests per minute`,
        category: "velocity"
      });
    }

    if (repeatedRapidFire >= 4) {
      rules.push({
        id: "velocity.rapid-fire",
        label: "Rapid-fire sequencing",
        weight: 1.1,
        score: clamp(repeatedRapidFire / 7, 0, 1),
        reason: `${repeatedRapidFire} near-instant requests were observed inside the last 1.5 seconds`,
        category: "velocity"
      });
    }

    if ((request.fingerprint.pageViewsInSession ?? 0) >= 30 && request.interaction.focusDurationMs < 2000) {
      rules.push({
        id: "velocity.pageview-churn",
        label: "Pageview churn without focus",
        weight: 0.9,
        score: clamp((request.fingerprint.pageViewsInSession ?? 0) / 60, 0, 1),
        reason: "Traffic is churning through many pages while spending almost no focused time on any single placement",
        category: "velocity"
      });
    }
  }

  private applyDeviceRules(
    request: ExchangeBidRequest,
    fingerprintState: FingerprintState,
    deviceHistory: DeviceHistory,
    rules: FraudRuleSignal[]
  ): void {
    const viewport = request.placement.viewport;
    const unusualDensity = viewport.density < 0.7 || viewport.density > 4.5;
    const botBrowser = request.fingerprint.browserFamily === "bot" || /bot|crawler|spider|headless|phantom/i.test(request.fingerprint.userAgent);
    const viewportVariance =
      standardDeviation(deviceHistory.lastViewportWidths) + standardDeviation(deviceHistory.lastViewportHeights);

    if (unusualDensity) {
      rules.push({
        id: "device.viewport-density",
        label: "Unusual viewport density",
        weight: 0.8,
        score: clamp(Math.abs(viewport.density - 2) / 3, 0, 1),
        reason: `Viewport density ${viewport.density} is outside the expected consumer-device range`,
        category: "device"
      });
    }

    if (botBrowser) {
      rules.push({
        id: "device.bot-signature",
        label: "Bot signature in user agent",
        weight: 1.5,
        score: 1,
        reason: "The user agent includes explicit automation or crawler markers",
        category: "signature"
      });
    }

    if (fingerprintState.userAgentHashes.size >= 5 && fingerprintState.sessionIds.size <= 2) {
      rules.push({
        id: "device.rotating-user-agents",
        label: "Rotating user agents",
        weight: 1.1,
        score: clamp(fingerprintState.userAgentHashes.size / 10, 0, 1),
        reason: "A single fingerprint is rotating through many user-agent signatures within a small session footprint",
        category: "device"
      });
    }

    if (deviceHistory.requests >= 8 && viewportVariance < 3) {
      rules.push({
        id: "device.static-viewport",
        label: "Static viewport automation",
        weight: 0.75,
        score: clamp((8 - viewportVariance) / 8, 0, 1),
        reason: "Repeated requests are reporting an implausibly static viewport fingerprint",
        category: "device"
      });
    }
  }

  private applyEngagementRules(
    request: ExchangeBidRequest,
    deviceHistory: DeviceHistory,
    sessionEvents: SessionWindowEntry[],
    rules: FraudRuleSignal[]
  ): void {
    const pointerEvents = request.interaction.pointerEvents;
    const focusDurationMs = request.interaction.focusDurationMs;
    const rageClicks = request.interaction.rageClicks;
    const scrollDepth = request.interaction.scrollDepth;
    const pointerRate = boundedRatio(pointerEvents, Math.max(focusDurationMs, 1) / 1000);
    const averageFocus = average(deviceHistory.lastFocusDurations);
    const averagePointerCount = average(deviceHistory.lastPointerCounts);
    const repeatZeroFocus = sessionEvents.filter((entry) => entry.focusDurationMs <= 200).length;

    if (focusDurationMs < 120 && pointerEvents === 0 && scrollDepth <= 0.02) {
      rules.push({
        id: "engagement.zero-focus",
        label: "Zero-focus impressions",
        weight: 1.25,
        score: 0.95,
        reason: "The placement received no meaningful focus, pointer, or scroll activity",
        category: "engagement"
      });
    }

    if (pointerRate > 35) {
      rules.push({
        id: "engagement.pointer-rate",
        label: "Unnatural pointer rate",
        weight: 0.9,
        score: clamp(pointerRate / 70, 0, 1),
        reason: `Pointer activity reached ${round(pointerRate, 2)} events per focused second`,
        category: "engagement"
      });
    }

    if (focusDurationMs > 0 && rageClicks >= 6 && pointerEvents <= rageClicks + 1) {
      rules.push({
        id: "engagement.rage-clicks",
        label: "Rage-click cluster",
        weight: 0.8,
        score: clamp(rageClicks / 10, 0, 1),
        reason: `${rageClicks} rage clicks were reported without surrounding navigation activity`,
        category: "engagement"
      });
    }

    if (deviceHistory.requests >= 10 && averageFocus < 350 && averagePointerCount < 1.5) {
      rules.push({
        id: "engagement.repeated-low-engagement",
        label: "Repeated low engagement",
        weight: 1,
        score: clamp((350 - averageFocus) / 350, 0, 1),
        reason: "Historical interactions for this device persistently show no real attention signals",
        category: "engagement"
      });
    }

    if (repeatZeroFocus >= 4) {
      rules.push({
        id: "engagement.session-repeat-zero-focus",
        label: "Repeated zero-focus session pattern",
        weight: 1.1,
        score: clamp(repeatZeroFocus / 8, 0, 1),
        reason: `${repeatZeroFocus} recent requests in the same session carried effectively zero focus time`,
        category: "engagement"
      });
    }
  }

  private applyTimingRules(
    request: ExchangeBidRequest,
    fingerprintState: FingerprintState,
    rules: FraudRuleSignal[],
    now: number
  ): void {
    const localHour = request.fingerprint.localHour ?? new Date(now).getUTCHours();
    const uptimeSeconds = (fingerprintState.lastSeenAt - fingerprintState.firstSeenAt) / 1000;

    if (localHour >= 2 && localHour <= 4 && fingerprintState.requestTimestamps.length >= 12) {
      rules.push({
        id: "timing.graveyard-burst",
        label: "Graveyard-hour burst",
        weight: 0.6,
        score: clamp(fingerprintState.requestTimestamps.length / 24, 0, 1),
        reason: "High-velocity traffic arrived during a low-likelihood local hour window",
        category: "timing"
      });
    }

    if (uptimeSeconds > 0 && fingerprintState.totalRequests >= 25 && uptimeSeconds < 90) {
      rules.push({
        id: "timing.session-age",
        label: "Compressed session age",
        weight: 0.95,
        score: clamp((90 - uptimeSeconds) / 90, 0, 1),
        reason: "A large number of bids were emitted in a very short session lifetime",
        category: "timing"
      });
    }
  }

  private applyNetworkRules(
    request: ExchangeBidRequest,
    fingerprintState: FingerprintState,
    rules: FraudRuleSignal[]
  ): void {
    const connectionType = request.fingerprint.connectionType ?? "unknown";
    const tabCount = request.fingerprint.tabCount ?? 1;
    const lowEntropyReferrer = !request.fingerprint.referrer || request.fingerprint.referrer === request.placement.pageUrl;

    if (connectionType === "offline") {
      rules.push({
        id: "network.offline-request",
        label: "Offline delivery anomaly",
        weight: 1.2,
        score: 0.92,
        reason: "The client reported offline network status while still requesting live exchange bids",
        category: "network"
      });
    }

    if (tabCount >= 18) {
      rules.push({
        id: "network.tab-farm",
        label: "Tab farm behavior",
        weight: 0.85,
        score: clamp(tabCount / 40, 0, 1),
        reason: `${tabCount} active tabs were reported in the same exchange fingerprint`,
        category: "network"
      });
    }

    if (fingerprintState.campaigns.size >= 6 && lowEntropyReferrer) {
      rules.push({
        id: "network.campaign-fanout",
        label: "Campaign fan-out with low referrer entropy",
        weight: 1,
        score: clamp(fingerprintState.campaigns.size / 12, 0, 1),
        reason: "The fingerprint is touching many campaigns without meaningful referrer diversity",
        category: "network"
      });
    }
  }

  private applySignatureRules(
    request: ExchangeBidRequest,
    fingerprintState: FingerprintState,
    sessionEvents: SessionWindowEntry[],
    rules: FraudRuleSignal[]
  ): void {
    const ua = request.fingerprint.userAgent;
    const suspiciousTokens = ["webdriver", "playwright", "selenium", "headless", "puppeteer", "curl/"];
    const tokenMatches = suspiciousTokens.filter((token) => ua.toLowerCase().includes(token)).length;
    const sameFocusPattern = sessionEvents.length >= 3 && sessionEvents.every((entry) => entry.focusDurationMs === sessionEvents[0]?.focusDurationMs);

    if (tokenMatches > 0) {
      rules.push({
        id: "signature.automation-token",
        label: "Automation token detected",
        weight: 1.4,
        score: clamp(tokenMatches / suspiciousTokens.length + 0.35, 0, 1),
        reason: "Automation-related user-agent tokens are present in the request fingerprint",
        category: "signature"
      });
    }

    if (sameFocusPattern) {
      rules.push({
        id: "signature.repeated-focus-pattern",
        label: "Repeated focus pattern",
        weight: 0.7,
        score: 0.8,
        reason: "Multiple session events report an identical focus duration, suggesting scripted playback",
        category: "signature"
      });
    }

    if (fingerprintState.sessionIds.size >= 7 && fingerprintState.userAgentHashes.size <= 1) {
      rules.push({
        id: "signature.session-fanout",
        label: "Session fan-out",
        weight: 0.95,
        score: clamp(fingerprintState.sessionIds.size / 12, 0, 1),
        reason: "A single device fingerprint is spawning many sessions under an identical browser signature",
        category: "signature"
      });
    }
  }

  private resolveTier(score: number, suspected: boolean): TrafficQualityTier {
    if (score >= 0.82) {
      return "blocked";
    }

    if (suspected || score >= 0.58) {
      return "discounted";
    }

    if (score <= 0.22) {
      return "premium";
    }

    return "standard";
  }

  private recordRequest(
    request: ExchangeBidRequest,
    fingerprintState: FingerprintState,
    deviceHistory: DeviceHistory,
    sessionEvents: SessionWindowEntry[],
    requestId: string,
    now: number
  ): void {
    fingerprintState.totalRequests += 1;
    fingerprintState.lastSeenAt = now;
    fingerprintState.requestTimestamps.push(now);
    fingerprintState.requestTimestamps = trimTimestamps(fingerprintState.requestTimestamps, now);
    fingerprintState.sessionIds.add(request.fingerprint.sessionId);
    fingerprintState.userAgentHashes.add(hashString(request.fingerprint.userAgent));
    fingerprintState.campaigns.add(request.placement.campaignId);

    deviceHistory.requests += 1;
    pushWindowValue(deviceHistory.lastViewportWidths, request.placement.viewport.width);
    pushWindowValue(deviceHistory.lastViewportHeights, request.placement.viewport.height);
    pushWindowValue(deviceHistory.lastFocusDurations, request.interaction.focusDurationMs);
    pushWindowValue(deviceHistory.lastPointerCounts, request.interaction.pointerEvents);
    pushWindowValue(deviceHistory.lastScrollDepths, request.interaction.scrollDepth);

    sessionEvents.push({
      seenAt: now,
      requestId,
      userAgent: request.fingerprint.userAgent,
      viewportWidth: request.placement.viewport.width,
      viewportHeight: request.placement.viewport.height,
      pointerEvents: request.interaction.pointerEvents,
      focusDurationMs: request.interaction.focusDurationMs,
      scrollDepth: request.interaction.scrollDepth,
      rageClicks: request.interaction.rageClicks
    });

    this.sessions.set(
      request.fingerprint.sessionId,
      sessionEvents.filter((entry) => now - entry.seenAt <= WINDOW_MS)
    );
  }
}
