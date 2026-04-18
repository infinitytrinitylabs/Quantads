/**
 * CreativeComposer — Canvas-based ad composition engine.
 *
 * Supports four ad formats:
 *   • banner      — 320×50 (mobile) or 728×90 (leaderboard)
 *   • interstitial — fullscreen overlay (375×667 / 1024×768 etc.)
 *   • native       — matches host UI dimensions, injected inline
 *   • video-preroll — pre-roll card overlay (1280×720)
 *
 * A/B testing:
 *   • Up to 10 creative variants can be registered per placement.
 *   • After 1 000 impressions per variant the worst performer
 *     (lowest CTR) is paused automatically.
 *
 * The Canvas2DLike interface mirrors the browser CanvasRenderingContext2D API
 * so the same logic works server-side (with a mock canvas in tests) and in
 * the browser (with the real HTMLCanvasElement).
 */

import type { CreativeVariant, AnimationSpeed, ColorScheme } from "./AdaptiveCreativeEngine";

// ─── Canvas interfaces ────────────────────────────────────────────────────────

export interface CanvasGradientLike {
  addColorStop(offset: number, color: string): void;
}

export interface Canvas2DLike {
  canvas: { width: number; height: number };
  // State
  globalAlpha: number;
  fillStyle: string | CanvasGradientLike;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textAlign: "left" | "center" | "right";
  textBaseline: "top" | "middle" | "bottom" | "alphabetic";
  shadowBlur: number;
  shadowColor: string;
  // Transforms / state stack
  save(): void;
  restore(): void;
  // Drawing
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, startAngle: number, endAngle: number): void;
  roundRect?(x: number, y: number, w: number, h: number, radii: number): void;
  fill(): void;
  stroke(): void;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  strokeText(text: string, x: number, y: number, maxWidth?: number): void;
  measureText(text: string): { width: number };
  // Gradients
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradientLike;
  createRadialGradient(
    x0: number, y0: number, r0: number,
    x1: number, y1: number, r1: number
  ): CanvasGradientLike;
  // Images (optional — not used server-side)
  drawImage?(img: unknown, x: number, y: number, w: number, h: number): void;
}

// ─── Ad format definitions ────────────────────────────────────────────────────

export type AdFormat = "banner-mobile" | "banner-leaderboard" | "interstitial" | "native" | "video-preroll";

export interface AdDimensions {
  width: number;
  height: number;
}

export const AD_DIMENSIONS: Record<AdFormat, AdDimensions> = {
  "banner-mobile": { width: 320, height: 50 },
  "banner-leaderboard": { width: 728, height: 90 },
  "interstitial": { width: 375, height: 667 },
  "native": { width: 360, height: 120 },
  "video-preroll": { width: 1280, height: 720 }
};

// ─── Composed creative ────────────────────────────────────────────────────────

export interface ComposedCreative {
  format: AdFormat;
  variantId: string;
  width: number;
  height: number;
  /** CSS animation class hint for the renderer */
  animationClass: string;
  /** Inline HTML representation (used by SmartAdRenderer) */
  htmlPayload: string;
  /** Serialised draw calls for replay / snapshot testing */
  drawLog: DrawCall[];
  composedAt: string;
}

export interface DrawCall {
  op: string;
  args: (string | number | boolean)[];
}

// ─── A/B variant tracker ──────────────────────────────────────────────────────

export interface AbVariantMetrics {
  variantId: string;
  impressions: number;
  clicks: number;
  ctr: number;
  paused: boolean;
  pausedReason?: string;
}

const AUTO_PAUSE_THRESHOLD_IMPRESSIONS = 1_000;

export class AbTestTracker {
  private readonly variants = new Map<string, AbVariantMetrics>();
  private readonly maxVariants: number;

  constructor(maxVariants = 10) {
    this.maxVariants = maxVariants;
  }

  register(variantId: string): void {
    if (this.variants.size >= this.maxVariants) {
      throw new Error(`Cannot register more than ${this.maxVariants} variants per placement`);
    }
    if (!this.variants.has(variantId)) {
      this.variants.set(variantId, {
        variantId,
        impressions: 0,
        clicks: 0,
        ctr: 0,
        paused: false
      });
    }
  }

  recordImpression(variantId: string): void {
    const v = this.getOrCreate(variantId);
    if (v.paused) return;
    v.impressions++;
    v.ctr = v.impressions > 0 ? v.clicks / v.impressions : 0;
    this.maybeAutoPause();
  }

  recordClick(variantId: string): void {
    const v = this.getOrCreate(variantId);
    if (v.paused) return;
    v.clicks++;
    v.ctr = v.impressions > 0 ? v.clicks / v.impressions : 0;
  }

  getMetrics(variantId: string): AbVariantMetrics | undefined {
    return this.variants.get(variantId);
  }

  getAllMetrics(): AbVariantMetrics[] {
    return [...this.variants.values()];
  }

  getActiveVariants(): AbVariantMetrics[] {
    return [...this.variants.values()].filter((v) => !v.paused);
  }

  pauseVariant(variantId: string, reason: string): void {
    const v = this.variants.get(variantId);
    if (v) {
      v.paused = true;
      v.pausedReason = reason;
    }
  }

  private getOrCreate(variantId: string): AbVariantMetrics {
    if (!this.variants.has(variantId)) {
      this.register(variantId);
    }
    return this.variants.get(variantId)!;
  }

  private maybeAutoPause(): void {
    // Only act if at least one variant has crossed the impression threshold
    const eligible = [...this.variants.values()].filter(
      (v) => !v.paused && v.impressions >= AUTO_PAUSE_THRESHOLD_IMPRESSIONS
    );
    if (eligible.length < 2) return;

    // Pause the variant with the lowest CTR
    const sorted = [...eligible].sort((a, b) => a.ctr - b.ctr);
    const worst = sorted[0]!;
    this.pauseVariant(
      worst.variantId,
      `Auto-paused: lowest CTR (${(worst.ctr * 100).toFixed(2)}%) after ${worst.impressions} impressions`
    );
  }
}

// ─── Animation helpers ────────────────────────────────────────────────────────

function animClass(speed: AnimationSpeed): string {
  const map: Record<AnimationSpeed, string> = {
    none: "ad-anim-none",
    slow: "ad-anim-slow",
    medium: "ad-anim-medium",
    fast: "ad-anim-fast"
  };
  return map[speed];
}

// ─── Draw-call logger ─────────────────────────────────────────────────────────

/**
 * Wraps a Canvas2DLike and records every draw call to `log`.
 * Used for snapshot testing and debugging without a real canvas.
 */
class LoggingCanvas implements Canvas2DLike {
  readonly log: DrawCall[] = [];

  canvas: { width: number; height: number };
  globalAlpha = 1;
  fillStyle: string | CanvasGradientLike = "#000000";
  strokeStyle = "#000000";
  lineWidth = 1;
  font = "16px sans-serif";
  textAlign: "left" | "center" | "right" = "left";
  textBaseline: "top" | "middle" | "bottom" | "alphabetic" = "alphabetic";
  shadowBlur = 0;
  shadowColor = "transparent";

  constructor(width: number, height: number) {
    this.canvas = { width, height };
  }

  private record(op: string, ...args: (string | number | boolean)[]): void {
    this.log.push({ op, args });
  }

  save(): void { this.record("save"); }
  restore(): void { this.record("restore"); }
  clearRect(x: number, y: number, w: number, h: number): void { this.record("clearRect", x, y, w, h); }
  fillRect(x: number, y: number, w: number, h: number): void { this.record("fillRect", x, y, w, h); }
  strokeRect(x: number, y: number, w: number, h: number): void { this.record("strokeRect", x, y, w, h); }
  beginPath(): void { this.record("beginPath"); }
  closePath(): void { this.record("closePath"); }
  moveTo(x: number, y: number): void { this.record("moveTo", x, y); }
  lineTo(x: number, y: number): void { this.record("lineTo", x, y); }
  arc(x: number, y: number, r: number, sa: number, ea: number): void { this.record("arc", x, y, r, sa, ea); }
  fill(): void { this.record("fill"); }
  stroke(): void { this.record("stroke"); }
  fillText(text: string, x: number, y: number): void { this.record("fillText", text, x, y); }
  strokeText(text: string, x: number, y: number): void { this.record("strokeText", text, x, y); }
  measureText(_text: string): { width: number } { return { width: _text.length * 8 }; }
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradientLike {
    this.record("createLinearGradient", x0, y0, x1, y1);
    return { addColorStop: (o, c) => this.record("addColorStop", o, c) };
  }
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): CanvasGradientLike {
    this.record("createRadialGradient", x0, y0, r0, x1, y1, r1);
    return { addColorStop: (o, c) => this.record("addColorStop", o, c) };
  }
}

// ─── Format-specific composers ────────────────────────────────────────────────

function composeBanner(ctx: Canvas2DLike, variant: CreativeVariant, format: AdFormat): void {
  const { width, height } = ctx.canvas;

  // Background
  ctx.fillStyle = variant.backgroundColor;
  ctx.fillRect(0, 0, width, height);

  // Accent left bar
  ctx.fillStyle = variant.accentColor;
  ctx.fillRect(0, 0, 6, height);

  // Headline
  ctx.fillStyle = variant.textColor;
  const isLeaderboard = format === "banner-leaderboard";
  ctx.font = `bold ${isLeaderboard ? 18 : 12}px sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(variant.headline, 14, height / 2 - (isLeaderboard ? 10 : 4), width - 120);

  if (isLeaderboard) {
    ctx.font = "13px sans-serif";
    ctx.fillText(variant.subheadline, 14, height / 2 + 12, width - 120);
  }

  // CTA button
  const btnW = isLeaderboard ? 110 : 80;
  const btnH = isLeaderboard ? 32 : 24;
  const btnX = width - btnW - 8;
  const btnY = (height - btnH) / 2;

  ctx.fillStyle = variant.accentColor;
  ctx.fillRect(btnX, btnY, btnW, btnH);

  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${isLeaderboard ? 13 : 10}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(variant.ctaText, btnX + btnW / 2, btnY + btnH / 2, btnW - 4);
}

function composeInterstitial(ctx: Canvas2DLike, variant: CreativeVariant): void {
  const { width, height } = ctx.canvas;

  // Background gradient
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, variant.backgroundColor);
  gradient.addColorStop(1, variant.accentColor + "44");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Image placeholder area
  ctx.fillStyle = variant.accentColor + "22";
  ctx.fillRect(0, 0, width, Math.round(height * 0.55));

  // Image slot label
  ctx.fillStyle = variant.accentColor;
  ctx.font = "bold 14px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`[Image ${variant.imageSlot}]`, width / 2, height * 0.55 / 2);

  // Text area
  const textTop = Math.round(height * 0.58);

  ctx.fillStyle = variant.textColor;
  ctx.font = `bold 28px sans-serif`;
  ctx.textBaseline = "top";
  ctx.fillText(variant.headline, width / 2, textTop, width - 40);

  ctx.font = "18px sans-serif";
  ctx.fillText(variant.subheadline, width / 2, textTop + 42, width - 40);

  ctx.font = "14px sans-serif";
  ctx.globalAlpha = 0.85;
  ctx.fillText(variant.bodyText, width / 2, textTop + 78, width - 60);
  ctx.globalAlpha = 1;

  // CTA button
  const btnW = 200;
  const btnH = 52;
  const btnX = (width - btnW) / 2;
  const btnY = height - btnH - 40;

  ctx.fillStyle = variant.accentColor;
  ctx.fillRect(btnX, btnY, btnW, btnH);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(variant.ctaText, width / 2, btnY + btnH / 2);

  // Close hint
  ctx.fillStyle = variant.textColor;
  ctx.globalAlpha = 0.5;
  ctx.font = "12px sans-serif";
  ctx.fillText("✕ Dismiss", width - 30, 20);
  ctx.globalAlpha = 1;
}

function composeNative(ctx: Canvas2DLike, variant: CreativeVariant): void {
  const { width, height } = ctx.canvas;

  ctx.fillStyle = variant.backgroundColor;
  ctx.fillRect(0, 0, width, height);

  // Thumbnail slot on left
  const thumbSize = height - 16;
  ctx.fillStyle = variant.accentColor + "33";
  ctx.fillRect(8, 8, thumbSize, thumbSize);
  ctx.fillStyle = variant.accentColor;
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`[Img ${variant.imageSlot}]`, 8 + thumbSize / 2, 8 + thumbSize / 2);

  // Text content
  const textLeft = thumbSize + 20;
  ctx.fillStyle = variant.textColor;
  ctx.font = "bold 15px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(variant.headline, textLeft, 10, width - textLeft - 80);

  ctx.font = "12px sans-serif";
  ctx.globalAlpha = 0.8;
  ctx.fillText(variant.subheadline, textLeft, 30, width - textLeft - 80);
  ctx.globalAlpha = 1;

  // CTA chip
  const chipW = 72;
  const chipH = 26;
  const chipX = width - chipW - 8;
  const chipY = (height - chipH) / 2;

  ctx.fillStyle = variant.accentColor;
  ctx.fillRect(chipX, chipY, chipW, chipH);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(variant.ctaText, chipX + chipW / 2, chipY + chipH / 2);

  // "Sponsored" label
  ctx.fillStyle = variant.textColor;
  ctx.globalAlpha = 0.4;
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText("Sponsored", width - 8, height - 4);
  ctx.globalAlpha = 1;
}

function composeVideoPreroll(ctx: Canvas2DLike, variant: CreativeVariant): void {
  const { width, height } = ctx.canvas;

  // Dark overlay representing the video frame
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);

  // Image/video preview area
  ctx.fillStyle = variant.accentColor + "11";
  ctx.fillRect(0, 0, width, height);

  // Image slot
  ctx.fillStyle = variant.accentColor + "22";
  ctx.fillRect(60, 60, width - 120, height - 180);

  ctx.fillStyle = variant.accentColor;
  ctx.font = "bold 24px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(`[Video Creative – Image ${variant.imageSlot}]`, width / 2, (height - 180) / 2 + 60);

  // Lower-third overlay
  ctx.fillStyle = "rgba(0,0,0,0.72)";
  ctx.fillRect(0, height - 120, width, 120);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 26px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(variant.headline, 40, height - 110, width - 280);

  ctx.font = "16px sans-serif";
  ctx.globalAlpha = 0.85;
  ctx.fillText(variant.subheadline, 40, height - 76, width - 280);
  ctx.globalAlpha = 1;

  // CTA button
  const btnW = 200;
  const btnH = 52;
  const btnX = width - btnW - 30;
  const btnY = height - 86;

  ctx.fillStyle = variant.accentColor;
  ctx.fillRect(btnX, btnY, btnW, btnH);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(variant.ctaText, btnX + btnW / 2, btnY + btnH / 2);

  // Skip countdown
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "13px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillText("Skip in 5s →", width - 20, 20);
}

// ─── HTML payload generator ───────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function generateHtml(variant: CreativeVariant, format: AdFormat, dims: AdDimensions): string {
  const { width, height } = dims;
  const isBanner = format === "banner-mobile" || format === "banner-leaderboard";
  const isNative = format === "native";

  if (isBanner) {
    return `<div class="qad-banner ${animClass(variant.animationSpeed)}" style="width:${width}px;height:${height}px;background:${escapeHtml(variant.backgroundColor)};display:flex;align-items:center;border-left:6px solid ${escapeHtml(variant.accentColor)};font-family:sans-serif;overflow:hidden;box-sizing:border-box;">
  <span style="flex:1;padding:0 8px;font-weight:bold;font-size:${height > 60 ? "14px" : "11px"};color:${escapeHtml(variant.textColor)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(variant.headline)}</span>
  <button style="flex-shrink:0;margin-right:8px;padding:4px 10px;background:${escapeHtml(variant.accentColor)};color:#fff;border:none;border-radius:4px;font-weight:bold;font-size:${height > 60 ? "12px" : "9px"};cursor:pointer;" onclick="window.__qad_click('${escapeHtml(variant.variantId)}')">${escapeHtml(variant.ctaText)}</button>
</div>`;
  }

  if (isNative) {
    return `<div class="qad-native ${animClass(variant.animationSpeed)}" style="width:${width}px;height:${height}px;background:${escapeHtml(variant.backgroundColor)};display:flex;align-items:center;font-family:sans-serif;border-radius:8px;overflow:hidden;box-sizing:border-box;">
  <div style="width:${height - 16}px;height:${height - 16}px;margin:8px;background:${escapeHtml(variant.accentColor)}22;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:10px;color:${escapeHtml(variant.accentColor)};">[Img&nbsp;${variant.imageSlot}]</div>
  <div style="flex:1;overflow:hidden;padding:8px 4px;">
    <div style="font-weight:bold;font-size:14px;color:${escapeHtml(variant.textColor)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(variant.headline)}</div>
    <div style="font-size:11px;color:${escapeHtml(variant.textColor)};opacity:0.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(variant.subheadline)}</div>
  </div>
  <button style="flex-shrink:0;margin:0 8px;padding:6px 12px;background:${escapeHtml(variant.accentColor)};color:#fff;border:none;border-radius:14px;font-weight:bold;font-size:11px;cursor:pointer;" onclick="window.__qad_click('${escapeHtml(variant.variantId)}')">${escapeHtml(variant.ctaText)}</button>
</div>`;
  }

  if (format === "interstitial") {
    return `<div class="qad-interstitial ${animClass(variant.animationSpeed)}" style="position:fixed;inset:0;width:${width}px;height:${height}px;background:linear-gradient(to bottom,${escapeHtml(variant.backgroundColor)},${escapeHtml(variant.accentColor)}44);display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:sans-serif;z-index:99999;box-sizing:border-box;">
  <div style="width:100%;height:55%;background:${escapeHtml(variant.accentColor)}22;display:flex;align-items:center;justify-content:center;font-size:18px;color:${escapeHtml(variant.accentColor)};">[Image ${variant.imageSlot}]</div>
  <div style="padding:24px 20px;text-align:center;">
    <h2 style="margin:0 0 8px;font-size:24px;color:${escapeHtml(variant.textColor)};">${escapeHtml(variant.headline)}</h2>
    <p style="margin:0 0 6px;font-size:16px;color:${escapeHtml(variant.textColor)};opacity:0.8;">${escapeHtml(variant.subheadline)}</p>
    <p style="margin:0 0 20px;font-size:13px;color:${escapeHtml(variant.textColor)};opacity:0.7;">${escapeHtml(variant.bodyText)}</p>
    <button style="padding:14px 40px;background:${escapeHtml(variant.accentColor)};color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:bold;cursor:pointer;" onclick="window.__qad_click('${escapeHtml(variant.variantId)}')">${escapeHtml(variant.ctaText)}</button>
  </div>
  <button style="position:absolute;top:16px;right:20px;background:none;border:none;font-size:20px;color:${escapeHtml(variant.textColor)};opacity:0.5;cursor:pointer;" onclick="window.__qad_dismiss('${escapeHtml(variant.variantId)}')">✕</button>
</div>`;
  }

  // video-preroll
  return `<div class="qad-preroll ${animClass(variant.animationSpeed)}" style="position:relative;width:${width}px;height:${height}px;background:#000;font-family:sans-serif;overflow:hidden;box-sizing:border-box;">
  <div style="position:absolute;inset:0;background:${escapeHtml(variant.accentColor)}11;display:flex;align-items:center;justify-content:center;font-size:20px;color:${escapeHtml(variant.accentColor)};">[Video Creative – Image ${variant.imageSlot}]</div>
  <div style="position:absolute;bottom:0;left:0;right:0;height:120px;background:rgba(0,0,0,0.72);display:flex;align-items:center;padding:0 40px;">
    <div style="flex:1;">
      <div style="font-weight:bold;font-size:22px;color:#fff;">${escapeHtml(variant.headline)}</div>
      <div style="font-size:14px;color:rgba(255,255,255,0.8);">${escapeHtml(variant.subheadline)}</div>
    </div>
    <button style="padding:14px 36px;background:${escapeHtml(variant.accentColor)};color:#fff;border:none;border-radius:6px;font-size:16px;font-weight:bold;cursor:pointer;" onclick="window.__qad_click('${escapeHtml(variant.variantId)}')">${escapeHtml(variant.ctaText)}</button>
  </div>
  <div style="position:absolute;top:16px;right:20px;color:rgba(255,255,255,0.6);font-size:13px;">Skip in 5s →</div>
</div>`;
}

// ─── CreativeComposer ─────────────────────────────────────────────────────────

export class CreativeComposer {
  private readonly abTrackers = new Map<string, AbTestTracker>();

  /**
   * Compose a creative for the given variant and format.
   * Returns a ComposedCreative with an HTML payload and a draw log.
   */
  compose(variant: CreativeVariant, format: AdFormat): ComposedCreative {
    const dims = AD_DIMENSIONS[format];
    const ctx = new LoggingCanvas(dims.width, dims.height);

    switch (format) {
      case "banner-mobile":
      case "banner-leaderboard":
        composeBanner(ctx, variant, format);
        break;
      case "interstitial":
        composeInterstitial(ctx, variant);
        break;
      case "native":
        composeNative(ctx, variant);
        break;
      case "video-preroll":
        composeVideoPreroll(ctx, variant);
        break;
    }

    return {
      format,
      variantId: variant.variantId,
      width: dims.width,
      height: dims.height,
      animationClass: animClass(variant.animationSpeed),
      htmlPayload: generateHtml(variant, format, dims),
      drawLog: ctx.log,
      composedAt: new Date().toISOString()
    };
  }

  /**
   * Compose the same variant for all supported formats (useful for advertiser
   * preview).
   */
  composeAllFormats(variant: CreativeVariant): Record<AdFormat, ComposedCreative> {
    return {
      "banner-mobile": this.compose(variant, "banner-mobile"),
      "banner-leaderboard": this.compose(variant, "banner-leaderboard"),
      "interstitial": this.compose(variant, "interstitial"),
      "native": this.compose(variant, "native"),
      "video-preroll": this.compose(variant, "video-preroll")
    };
  }

  /** Get or create an AbTestTracker for a placement. */
  getAbTracker(placementId: string): AbTestTracker {
    if (!this.abTrackers.has(placementId)) {
      this.abTrackers.set(placementId, new AbTestTracker());
    }
    return this.abTrackers.get(placementId)!;
  }

  /** Register a variant for A/B testing under a placement. */
  registerVariant(placementId: string, variantId: string): void {
    this.getAbTracker(placementId).register(variantId);
  }

  /** Record that an impression was served for the given variant. */
  recordImpression(placementId: string, variantId: string): void {
    this.getAbTracker(placementId).recordImpression(variantId);
  }

  /** Record a click for the given variant. */
  recordClick(placementId: string, variantId: string): void {
    this.getAbTracker(placementId).recordClick(variantId);
  }

  /** Return all A/B metrics for a placement. */
  getAbMetrics(placementId: string): AbVariantMetrics[] {
    return this.getAbTracker(placementId).getAllMetrics();
  }
}

export const creativeComposer = new CreativeComposer();
