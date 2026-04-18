/**
 * SmartAdRenderer — server-side HTML-string renderer for adaptive ad creatives.
 *
 * Responsibilities:
 *   • Wraps a ComposedCreative's HTML payload with transition scaffolding.
 *   • Renders a "Why this ad?" transparency overlay with targeting rationale.
 *   • Produces an advertiser preview showing how the same ad looks at low,
 *     medium, and high attention levels.
 *
 * This module is deliberately dependency-free (no browser APIs, no React runtime).
 * The `.tsx` extension exists so TypeScript compiles JSX in files that import
 * it alongside other `.tsx` files in the same directory.  All rendering here
 * is pure string templating.
 */

import type { ComposedCreative } from "../services/CreativeComposer";
import type { AdaptiveCreativeResult, CreativeVariant } from "../services/AdaptiveCreativeEngine";
import type { EmotionEstimate } from "../services/EmotionDetector";

// ─── Public types ─────────────────────────────────────────────────────────────

export type TransitionStyle = "fade" | "slide-up" | "slide-left" | "none";

export interface SmartAdRenderOptions {
  /** CSS transition when the creative changes (default: "fade") */
  transition?: TransitionStyle;
  /** Show the "Why this ad?" transparency button (default: true) */
  showTransparencyButton?: boolean;
  /** Unique DOM id prefix for this ad slot */
  containerId?: string;
}

export interface RenderedSmartAd {
  html: string;
  containerId: string;
  variantId: string;
  /** Inline CSS to inject into the page <head> (deduplicatable by containerId) */
  styles: string;
  /** Inline JS bootstrap snippet */
  scripts: string;
}

export interface TransparencyOverlay {
  html: string;
}

export interface AdvertiserPreviewBundle {
  /** Complete HTML document for the preview page */
  previewHtml: string;
  levels: {
    low: RenderedSmartAd;
    medium: RenderedSmartAd;
    high: RenderedSmartAd;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeJs(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n");
}

let _idCounter = 0;
function nextId(): string {
  return `qad-${Date.now()}-${++_idCounter}`;
}

// ─── CSS / animation styles ───────────────────────────────────────────────────

const ANIMATION_CSS = `
.ad-anim-none { animation: none !important; transition: none !important; }
.ad-anim-slow { animation-duration: 2s !important; transition-duration: 600ms !important; }
.ad-anim-medium { animation-duration: 1s !important; transition-duration: 300ms !important; }
.ad-anim-fast { animation-duration: 0.4s !important; transition-duration: 150ms !important; }
@keyframes qad-fade-in { from { opacity:0 } to { opacity:1 } }
@keyframes qad-slide-up { from { transform:translateY(24px);opacity:0 } to { transform:translateY(0);opacity:1 } }
@keyframes qad-slide-left { from { transform:translateX(24px);opacity:0 } to { transform:translateX(0);opacity:1 } }
`.trim();

function transitionStyle(style: TransitionStyle): string {
  switch (style) {
    case "fade": return "animation:qad-fade-in 0.35s ease both;";
    case "slide-up": return "animation:qad-slide-up 0.35s ease both;";
    case "slide-left": return "animation:qad-slide-left 0.35s ease both;";
    default: return "";
  }
}

function containerStyles(containerId: string, transition: TransitionStyle): string {
  return `
#${containerId} { position:relative; display:inline-block; }
#${containerId} .qad-creative-wrap { ${transitionStyle(transition)} }
#${containerId} .qad-why-btn {
  position:absolute; bottom:4px; right:4px; z-index:10;
  font-size:9px; padding:2px 5px; background:rgba(0,0,0,0.45);
  color:#fff; border:none; border-radius:3px; cursor:pointer;
  line-height:1.4; font-family:sans-serif;
}
#${containerId} .qad-transparency-overlay {
  display:none; position:absolute; inset:0; z-index:20;
  background:rgba(0,0,0,0.82); color:#fff;
  font-size:12px; font-family:sans-serif; padding:12px 14px;
  border-radius:4px; overflow-y:auto; box-sizing:border-box;
}
#${containerId} .qad-transparency-overlay.open { display:block; }
#${containerId} .qad-close-overlay {
  position:absolute; top:6px; right:10px; background:none;
  border:none; color:#fff; font-size:16px; cursor:pointer;
}
${ANIMATION_CSS}
`.trim();
}

// ─── Transparency overlay ─────────────────────────────────────────────────────

function renderTransparencyOverlay(
  variant: CreativeVariant,
  estimate: EmotionEstimate | undefined,
  containerId: string
): string {
  const rationale = variant.targetingRationale.map(
    (line) => `<li style="margin-bottom:4px;">${escapeHtml(line)}</li>`
  ).join("\n");

  const emotionBlock = estimate
    ? `<p style="margin:0 0 6px;"><strong>Detected emotion:</strong> ${escapeHtml(estimate.state)} (${Math.round(estimate.confidence * 100)}% confidence)</p>
       <p style="margin:0 0 6px;"><strong>Attention score:</strong> ${Math.round(estimate.attentionScore * 100)}%</p>`
    : "";

  return `
<div class="qad-transparency-overlay" id="${containerId}-overlay">
  <button class="qad-close-overlay" onclick="document.getElementById('${escapeJs(containerId)}-overlay').classList.remove('open')" aria-label="Close">✕</button>
  <p style="margin:0 0 8px;font-size:14px;font-weight:bold;">Why this ad?</p>
  ${emotionBlock}
  <p style="margin:0 0 4px;font-size:11px;opacity:0.8;">Targeting factors:</p>
  <ul style="margin:0;padding-left:16px;font-size:11px;line-height:1.6;">
    ${rationale}
  </ul>
  <p style="margin:8px 0 0;font-size:10px;opacity:0.6;">Quantads — Privacy-first, no PII stored</p>
</div>`.trim();
}

// ─── Bootstrap script ─────────────────────────────────────────────────────────

function bootstrapScript(containerId: string, variantId: string): string {
  return `
(function(){
  if(typeof window==='undefined') return;
  window.__qad_click = window.__qad_click || function(vid){
    var e = new CustomEvent('qad:click', {detail:{variantId:vid}, bubbles:true});
    document.dispatchEvent(e);
  };
  window.__qad_dismiss = window.__qad_dismiss || function(vid){
    var el = document.getElementById('${escapeJs(containerId)}');
    if(el){ el.style.display='none'; }
    var e = new CustomEvent('qad:dismiss', {detail:{variantId:vid}, bubbles:true});
    document.dispatchEvent(e);
  };
  var btn = document.querySelector('#${escapeJs(containerId)} .qad-why-btn');
  if(btn){
    btn.addEventListener('click', function(){
      var ov = document.getElementById('${escapeJs(containerId)}-overlay');
      if(ov) ov.classList.add('open');
    });
  }
})();`.trim();
}

// ─── SmartAdRenderer ──────────────────────────────────────────────────────────

export class SmartAdRenderer {
  /**
   * Render a composed creative into a self-contained HTML snippet
   * with optional transparency overlay and transition animation.
   */
  render(
    composed: ComposedCreative,
    variant: CreativeVariant,
    options: SmartAdRenderOptions = {},
    emotionEstimate?: EmotionEstimate
  ): RenderedSmartAd {
    const {
      transition = "fade",
      showTransparencyButton = true,
      containerId = nextId()
    } = options;

    const overlayHtml = showTransparencyButton
      ? renderTransparencyOverlay(variant, emotionEstimate, containerId)
      : "";

    const whyBtn = showTransparencyButton
      ? `<button class="qad-why-btn" title="Why this ad?" aria-label="Why this ad?">Why this ad?</button>`
      : "";

    const html = `
<div id="${containerId}" class="qad-ad-container" data-variant-id="${escapeHtml(variant.variantId)}" data-format="${escapeHtml(composed.format)}">
  <div class="qad-creative-wrap">
    ${composed.htmlPayload}
  </div>
  ${whyBtn}
  ${overlayHtml}
</div>`.trim();

    const styles = containerStyles(containerId, transition);
    const scripts = bootstrapScript(containerId, variant.variantId);

    return { html, containerId, variantId: variant.variantId, styles, scripts };
  }

  /**
   * Wrap a rendered ad in a full standalone HTML page.
   * Useful for server-side email embedding or iframe serving.
   */
  renderPage(rendered: RenderedSmartAd, pageTitle = "Ad Preview"): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(pageTitle)}</title>
<style>${rendered.styles}</style>
</head>
<body style="margin:0;padding:16px;background:#f3f4f6;font-family:sans-serif;">
${rendered.html}
<script>${rendered.scripts}</script>
</body>
</html>`;
  }

  /**
   * Build an advertiser preview bundle that shows the same creative at
   * three attention levels side-by-side.
   */
  renderAdvertiserPreview(
    levels: Record<"low" | "medium" | "high", { result: AdaptiveCreativeResult; composed: ComposedCreative }>,
    format: string
  ): AdvertiserPreviewBundle {
    const low = this.render(levels.low.composed, levels.low.result.variant, { containerId: "qad-preview-low", transition: "none" });
    const medium = this.render(levels.medium.composed, levels.medium.result.variant, { containerId: "qad-preview-medium", transition: "none" });
    const high = this.render(levels.high.composed, levels.high.result.variant, { containerId: "qad-preview-high", transition: "none" });

    const allStyles = [low.styles, medium.styles, high.styles].join("\n");
    const allScripts = [low.scripts, medium.scripts, high.scripts].join("\n");

    const previewHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quantads — Advertiser Creative Preview</title>
<style>
  body { margin:0; padding:24px; background:#111827; font-family:sans-serif; color:#f9fafb; }
  h1 { font-size:20px; margin:0 0 4px; }
  .subtitle { font-size:13px; color:#9ca3af; margin:0 0 24px; }
  .preview-grid { display:flex; gap:24px; flex-wrap:wrap; }
  .preview-card { background:#1f2937; border-radius:12px; padding:16px; }
  .preview-label { font-size:11px; font-weight:bold; letter-spacing:.08em; text-transform:uppercase; margin-bottom:12px; }
  .low .preview-label { color:#ef4444; }
  .medium .preview-label { color:#f59e0b; }
  .high .preview-label { color:#22c55e; }
  .preview-meta { font-size:11px; color:#6b7280; margin-top:10px; }
  ${allStyles}
</style>
</head>
<body>
<h1>Smart Ad Creative Preview</h1>
<p class="subtitle">Format: ${escapeHtml(format)} — See how your ad adapts at different attention levels</p>
<div class="preview-grid">
  <div class="preview-card low">
    <div class="preview-label">⚡ Low Attention (&lt;30%)</div>
    ${low.html}
    <div class="preview-meta">${escapeHtml(levels.low.result.variant.colorScheme)} · ${escapeHtml(levels.low.result.variant.animationSpeed)} animation</div>
  </div>
  <div class="preview-card medium">
    <div class="preview-label">🎯 Medium Attention (30–70%)</div>
    ${medium.html}
    <div class="preview-meta">${escapeHtml(levels.medium.result.variant.colorScheme)} · ${escapeHtml(levels.medium.result.variant.animationSpeed)} animation</div>
  </div>
  <div class="preview-card high">
    <div class="preview-label">🧠 High Attention (&gt;70%)</div>
    ${high.html}
    <div class="preview-meta">${escapeHtml(levels.high.result.variant.colorScheme)} · ${escapeHtml(levels.high.result.variant.animationSpeed)} animation</div>
  </div>
</div>
<script>${allScripts}</script>
</body>
</html>`;

    return { previewHtml, levels: { low, medium, high } };
  }
}

export const smartAdRenderer = new SmartAdRenderer();
