/**
 * BotHeuristics – rule-based bot detection to complement the ML anomaly score.
 *
 * Heuristics checked:
 *  1. ROBOTIC_DWELL   – Identical dwell-time across sessions (sub-millisecond precision).
 *  2. NO_MOUSE        – Zero mouse-movement events during attention periods.
 *  3. GEO_JUMP        – Impossible geographic travel (> 900 km/h between consecutive events).
 *  4. HEADLESS        – Headless-browser fingerprint (no WebGL, no AudioContext).
 *
 * Each heuristic contributes a numeric sub-score [0, 1] and produces a flag string
 * when triggered. The final composite score is the weighted average of sub-scores.
 */

import { BotHeuristicInput } from "../types";
import { roundToDecimals } from "../lib/mathUtils";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum plausible travel speed in km/h (supersonic aircraft ~2× commercial). */
const MAX_PLAUSIBLE_SPEED_KMH = 900;

/** Weights for each heuristic sub-score. */
const W_ROBOTIC_DWELL  = 0.30;
const W_NO_MOUSE       = 0.25;
const W_GEO_JUMP       = 0.25;
const W_HEADLESS       = 0.20;

/** If consecutive dwell samples are within this many ms of each other → suspicious. */
const ROBOTIC_DWELL_EPSILON_MS = 2;

/** Minimum number of dwell samples before the robotic check fires. */
const ROBOTIC_DWELL_MIN_SAMPLES = 5;

// ── Earth geometry helper ─────────────────────────────────────────────────────

/** Haversine distance in kilometres between two coordinates. */
function haversineKm(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371; // Earth radius km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// ── Heuristic sub-scores ──────────────────────────────────────────────────────

/**
 * ROBOTIC_DWELL: detect suspiciously identical dwell-time values.
 * Returns a score of 1.0 when all samples fall within ROBOTIC_DWELL_EPSILON_MS
 * of the median. Scales linearly for partial matches.
 */
function roboticDwellScore(dwellSamples: number[]): { score: number; flagged: boolean } {
  if (dwellSamples.length < ROBOTIC_DWELL_MIN_SAMPLES) {
    return { score: 0, flagged: false };
  }
  const sorted = dwellSamples.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const identicalCount = dwellSamples.filter(
    (d) => Math.abs(d - median) <= ROBOTIC_DWELL_EPSILON_MS
  ).length;
  const ratio = identicalCount / dwellSamples.length;
  // Flag when 80%+ of samples are within epsilon of the median
  const flagged = ratio >= 0.8;
  return { score: flagged ? ratio : ratio * 0.4, flagged };
}

/**
 * NO_MOUSE: detect complete absence of mouse-movement events.
 * Legitimate users virtually always generate at least some movement.
 */
function noMouseScore(mouseMovementSamples: number[]): { score: number; flagged: boolean } {
  if (mouseMovementSamples.length === 0) {
    return { score: 1.0, flagged: true };
  }
  const totalMovement = mouseMovementSamples.reduce((s, v) => s + Math.abs(v), 0);
  if (totalMovement === 0) {
    return { score: 1.0, flagged: true };
  }
  return { score: 0, flagged: false };
}

/**
 * GEO_JUMP: detect impossible geographic jumps between consecutive location events.
 * Returns the maximum per-hop score (0 = plausible, 1 = impossible).
 */
function geoJumpScore(
  locations: Array<{ latitude: number; longitude: number; timestampMs: number }>
): { score: number; flagged: boolean } {
  if (locations.length < 2) return { score: 0, flagged: false };

  const sorted = locations.slice().sort((a, b) => a.timestampMs - b.timestampMs);
  let maxScore = 0;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const distanceKm = haversineKm(
      prev.latitude, prev.longitude,
      curr.latitude, curr.longitude
    );
    const durationHours = (curr.timestampMs - prev.timestampMs) / 3_600_000;

    if (durationHours <= 0) {
      // Two events at exactly the same time from different places → impossible
      if (distanceKm > 1) {
        maxScore = 1;
      }
      continue;
    }

    const speedKmh = distanceKm / durationHours;
    if (speedKmh > MAX_PLAUSIBLE_SPEED_KMH) {
      // Score proportional to how much the speed exceeds the plausible limit
      const s = Math.min(1, (speedKmh - MAX_PLAUSIBLE_SPEED_KMH) / MAX_PLAUSIBLE_SPEED_KMH);
      if (s > maxScore) maxScore = s;
    }
  }

  return { score: maxScore, flagged: maxScore > 0.5 };
}

/**
 * HEADLESS: detect headless-browser fingerprints.
 * Missing WebGL or AudioContext is a strong signal.
 */
function headlessScore(fingerprint: BotHeuristicInput["browserFingerprint"]): {
  score: number;
  flagged: boolean;
} {
  let points = 0;
  if (!fingerprint.hasWebGL) points += 0.5;
  if (!fingerprint.hasAudioContext) points += 0.5;

  // Known headless UA substrings
  const ua = fingerprint.userAgent.toLowerCase();
  if (
    ua.includes("headlesschrome") ||
    ua.includes("phantomjs") ||
    ua.includes("selenium") ||
    ua.includes("puppeteer") ||
    ua.includes("playwright")
  ) {
    points = Math.min(1, points + 0.5);
  }

  const score = Math.min(1, points);
  return { score, flagged: score >= 0.5 };
}

// ── BotHeuristics public API ──────────────────────────────────────────────────

export interface BotHeuristicResult {
  compositeScore: number;
  flags: string[];
  subscores: {
    roboticDwell: number;
    noMouse: number;
    geoJump: number;
    headless: number;
  };
}

export class BotHeuristics {
  /**
   * Analyse the provided input and return a composite heuristic score [0, 1]
   * plus a list of flag strings for each triggered heuristic.
   */
  analyse(input: BotHeuristicInput): BotHeuristicResult {
    const dwell  = roboticDwellScore(input.dwellTimeSamples);
    const mouse  = noMouseScore(input.mouseMovementSamples);
    const geo    = geoJumpScore(input.locations);
    const headless = headlessScore(input.browserFingerprint);

    const flags: string[] = [];
    if (dwell.flagged)    flags.push("ROBOTIC_DWELL");
    if (mouse.flagged)    flags.push("NO_MOUSE");
    if (geo.flagged)      flags.push("GEO_JUMP");
    if (headless.flagged) flags.push("HEADLESS");

    const compositeScore =
      dwell.score   * W_ROBOTIC_DWELL +
      mouse.score   * W_NO_MOUSE +
      geo.score     * W_GEO_JUMP +
      headless.score * W_HEADLESS;

    return {
      compositeScore: roundToDecimals(compositeScore, 4),
      flags,
      subscores: {
        roboticDwell: roundToDecimals(dwell.score, 4),
        noMouse:      roundToDecimals(mouse.score, 4),
        geoJump:      roundToDecimals(geo.score, 4),
        headless:     roundToDecimals(headless.score, 4)
      }
    };
  }
}

export const botHeuristics = new BotHeuristics();
