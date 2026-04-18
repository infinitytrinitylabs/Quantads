import { Canvas2DLike, CanvasGradientLike } from "../advertiser-loop/AttentionHeatmapRenderer";
import {
  AdaptiveCreativeDecision,
  CompositionLayer,
  SmartAdComposition,
  SmartAdRequest,
  clamp,
  formatCurrency,
  round,
  withAlpha
} from "./types";

interface TextBlock {
  lines: string[];
  lineHeight: number;
}

class RecordingGradient implements CanvasGradientLike {
  readonly stops: Array<{ offset: number; color: string }> = [];

  addColorStop(offset: number, color: string): void {
    this.stops.push({ offset, color });
  }
}

export class RecordingCanvasContext implements Canvas2DLike {
  canvas: { width: number; height: number };
  globalAlpha = 1;
  fillStyle: string | CanvasGradientLike = "#000000";
  strokeStyle = "#000000";
  lineWidth = 1;
  font = "12px sans-serif";
  textAlign: "left" | "center" | "right" = "left";
  textBaseline: "top" | "middle" | "bottom" = "top";
  readonly operations: string[] = [];

  constructor(width: number, height: number) {
    this.canvas = { width, height };
  }

  save(): void {
    this.operations.push("save");
  }

  restore(): void {
    this.operations.push("restore");
  }

  clearRect(x: number, y: number, width: number, height: number): void {
    this.operations.push(`clearRect:${x},${y},${width},${height}`);
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.operations.push(`fillRect:${x},${y},${width},${height}`);
  }

  strokeRect(x: number, y: number, width: number, height: number): void {
    this.operations.push(`strokeRect:${x},${y},${width},${height}`);
  }

  beginPath(): void {
    this.operations.push("beginPath");
  }

  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void {
    this.operations.push(`arc:${x},${y},${radius},${startAngle},${endAngle}`);
  }

  fill(): void {
    this.operations.push("fill");
  }

  stroke(): void {
    this.operations.push("stroke");
  }

  fillText(text: string, x: number, y: number): void {
    this.operations.push(`fillText:${text}@${x},${y}`);
  }

  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number
  ): CanvasGradientLike {
    this.operations.push(`gradient:${x0},${y0},${r0},${x1},${y1},${r1}`);
    return new RecordingGradient();
  }
}

const wrapText = (text: string, maxCharsPerLine: number, lineHeight: number): TextBlock => {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) {
    lines.push(current);
  }

  return { lines, lineHeight };
};

const pushLayer = (
  layers: CompositionLayer[],
  layer: CompositionLayer
): void => {
  layers.push(layer);
};

export class CreativeComposer {
  compose(
    ctx: Canvas2DLike,
    request: SmartAdRequest,
    decision: AdaptiveCreativeDecision
  ): SmartAdComposition {
    const width = request.placement.width;
    const height = request.placement.height;
    ctx.canvas.width = width;
    ctx.canvas.height = height;
    ctx.globalAlpha = 1;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const layers: CompositionLayer[] = [];

    const headline = decision.creativeStrategy.headline;
    const body = decision.creativeStrategy.body;
    const ctaLabel = decision.creativeStrategy.ctaLabel;
    const badges = decision.creativeStrategy.badges;
    const proofPoints = decision.creativeStrategy.proofPoints;
    const footer = `${decision.emotion.primaryEmotion} · ${decision.emotion.attentionBand} attention · ${formatCurrency(request.product.price, request.product.currency)}`;

    const headlineBlock = wrapText(headline, width >= 540 ? 28 : 22, width >= 540 ? 34 : 28);
    const bodyBlock = wrapText(body, width >= 540 ? 42 : 30, 22);
    const ctaWidth = Math.max(124, Math.min(196, ctaLabel.length * 12 + 44));
    const ctaHeight = 46;
    const surfacePadding = width >= 540 ? 28 : 20;
    const contentWidth = width - surfacePadding * 2;

    this.drawBackground(ctx, width, height, decision, layers);
    this.drawHeaderBand(ctx, width, surfacePadding, request, decision, layers);
    this.drawGlow(ctx, width, height, decision, layers);
    this.drawHeadline(ctx, surfacePadding, 72, contentWidth, headlineBlock, decision, layers);
    const bodyTop = 72 + headlineBlock.lines.length * headlineBlock.lineHeight + 14;
    this.drawBody(ctx, surfacePadding, bodyTop, contentWidth, bodyBlock, decision, layers);
    const badgeTop = bodyTop + bodyBlock.lines.length * bodyBlock.lineHeight + 18;
    this.drawBadges(ctx, surfacePadding, badgeTop, badges, decision, layers);
    const proofTop = badgeTop + 40;
    this.drawProofPoints(ctx, surfacePadding, proofTop, proofPoints, decision, layers);
    const meterTop = height - 96;
    this.drawEmotionMeter(ctx, surfacePadding, meterTop, contentWidth - ctaWidth - 16, decision, layers);
    const ctaX = width - surfacePadding - ctaWidth;
    const ctaY = height - 90;
    this.drawCta(ctx, ctaX, ctaY, ctaWidth, ctaHeight, ctaLabel, decision, layers);
    this.drawFooter(ctx, surfacePadding, height - 28, footer, decision, layers);

    const filledArea = layers.reduce((sum, layer) => sum + layer.width * layer.height, 0);

    return {
      width,
      height,
      layers,
      metrics: {
        headlineLines: headlineBlock.lines.length,
        bodyLines: bodyBlock.lines.length,
        badgeCount: badges.length,
        proofPointCount: proofPoints.length,
        canvasFillRatio: round(clamp(filledArea / Math.max(width * height, 1), 0, 1)),
        ctaProminence: round(ctaWidth / width),
        motionEnergy: decision.selected.motion === "energetic" ? 1 : decision.selected.motion === "gentle" ? 0.55 : 0.22
      },
      palette: decision.selected.palette,
      operationLog: ctx instanceof RecordingCanvasContext ? [...ctx.operations] : [],
      altText: `${request.product.brandName} smart ad with headline ${headline} and CTA ${ctaLabel}.`,
      ariaLabel: `${request.product.brandName} adaptive smart ad for ${decision.emotion.primaryEmotion} attention state.`,
      headline,
      body,
      ctaLabel,
      footer,
      badges,
      proofPoints
    };
  }

  private drawBackground(
    ctx: Canvas2DLike,
    width: number,
    height: number,
    decision: AdaptiveCreativeDecision,
    layers: CompositionLayer[]
  ): void {
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = decision.selected.palette.background;
    ctx.fillRect(0, 0, width, height);
    pushLayer(layers, {
      layerId: "background",
      type: "background",
      x: 0,
      y: 0,
      width,
      height,
      color: decision.selected.palette.background,
      opacity: 1
    });
    ctx.restore();
  }

  private drawHeaderBand(
    ctx: Canvas2DLike,
    width: number,
    padding: number,
    request: SmartAdRequest,
    decision: AdaptiveCreativeDecision,
    layers: CompositionLayer[]
  ): void {
    ctx.save();
    ctx.fillStyle = withAlpha(decision.selected.palette.surface, 0.55);
    ctx.fillRect(padding, 18, width - padding * 2, 34);
    ctx.strokeStyle = decision.selected.palette.border;
    ctx.strokeRect(padding, 18, width - padding * 2, 34);
    ctx.fillStyle = decision.selected.palette.text;
    ctx.font = "bold 13px sans-serif";
    ctx.fillText(`${request.product.brandName} · ${decision.emotion.primaryEmotion}`, padding + 12, 28);
    ctx.font = "12px sans-serif";
    ctx.fillStyle = decision.selected.palette.mutedText;
    ctx.fillText(`${request.placement.platform} · ${decision.selected.layout}`, padding + 180, 28);
    pushLayer(layers, {
      layerId: "header-band",
      type: "shape",
      x: padding,
      y: 18,
      width: width - padding * 2,
      height: 34,
      color: decision.selected.palette.surface,
      opacity: 0.55
    });
    ctx.restore();
  }

  private drawGlow(
    ctx: Canvas2DLike,
    width: number,
    height: number,
    decision: AdaptiveCreativeDecision,
    layers: CompositionLayer[]
  ): void {
    ctx.save();
    const radius = Math.max(width, height) * (decision.selected.motion === "energetic" ? 0.45 : 0.32);
    const gradient = ctx.createRadialGradient(width * 0.75, height * 0.18, 0, width * 0.75, height * 0.18, radius);
    gradient.addColorStop(0, withAlpha(decision.selected.palette.accent, 0.42));
    gradient.addColorStop(0.55, withAlpha(decision.selected.palette.accent, 0.12));
    gradient.addColorStop(1, withAlpha(decision.selected.palette.accent, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(width * 0.75, height * 0.18, radius, 0, Math.PI * 2);
    ctx.fill();
    pushLayer(layers, {
      layerId: "glow",
      type: "glow",
      x: round(width * 0.75 - radius),
      y: round(height * 0.18 - radius),
      width: round(radius * 2),
      height: round(radius * 2),
      color: decision.selected.palette.accent,
      opacity: 0.42
    });
    ctx.restore();
  }

  private drawHeadline(
    ctx: Canvas2DLike,
    x: number,
    y: number,
    width: number,
    block: TextBlock,
    decision: AdaptiveCreativeDecision,
    layers: CompositionLayer[]
  ): void {
    ctx.save();
    ctx.font = "bold 30px sans-serif";
    ctx.fillStyle = decision.selected.palette.text;
    block.lines.forEach((line, index) => {
      const top = y + index * block.lineHeight;
      ctx.fillText(line, x, top);
      pushLayer(layers, {
        layerId: `headline-${index}`,
        type: "text",
        x,
        y: top,
        width,
        height: block.lineHeight,
        color: decision.selected.palette.text,
        text: line,
        opacity: 1
      });
    });
    ctx.restore();
  }

  private drawBody(
    ctx: Canvas2DLike,
    x: number,
    y: number,
    width: number,
    block: TextBlock,
    decision: AdaptiveCreativeDecision,
    layers: CompositionLayer[]
  ): void {
    ctx.save();
    ctx.font = "15px sans-serif";
    ctx.fillStyle = decision.selected.palette.mutedText;
    block.lines.forEach((line, index) => {
      const top = y + index * block.lineHeight;
      ctx.fillText(line, x, top);
      pushLayer(layers, {
        layerId: `body-${index}`,
        type: "text",
        x,
        y: top,
        width,
        height: block.lineHeight,
        color: decision.selected.palette.mutedText,
        text: line,
        opacity: 0.94
      });
    });
    ctx.restore();
  }

  private drawBadges(
    ctx: Canvas2DLike,
    x: number,
    y: number,
    badges: string[],
    decision: AdaptiveCreativeDecision,
    layers: CompositionLayer[]
  ): void {
    ctx.save();
    let cursor = x;
    for (const [index, badge] of badges.entries()) {
      const width = Math.max(76, badge.length * 8 + 24);
      ctx.fillStyle = withAlpha(decision.selected.palette.accent, index === 0 ? 0.24 : 0.16);
      ctx.fillRect(cursor, y, width, 24);
      ctx.strokeStyle = decision.selected.palette.border;
      ctx.strokeRect(cursor, y, width, 24);
      ctx.font = "12px sans-serif";
      ctx.fillStyle = decision.selected.palette.text;
      ctx.fillText(badge, cursor + 10, y + 6);
      pushLayer(layers, {
        layerId: `badge-${index}`,
        type: "badge",
        x: cursor,
        y,
        width,
        height: 24,
        color: decision.selected.palette.accent,
        text: badge,
        opacity: index === 0 ? 0.24 : 0.16
      });
      cursor += width + 8;
    }
    ctx.restore();
  }

  private drawProofPoints(
    ctx: Canvas2DLike,
    x: number,
    y: number,
    proofPoints: string[],
    decision: AdaptiveCreativeDecision,
    layers: CompositionLayer[]
  ): void {
    ctx.save();
    ctx.font = "13px sans-serif";
    proofPoints.forEach((proof, index) => {
      const top = y + index * 22;
      ctx.fillStyle = decision.selected.palette.accent;
      ctx.fillRect(x, top + 4, 8, 8);
      ctx.fillStyle = decision.selected.palette.text;
      ctx.fillText(proof, x + 18, top);
      pushLayer(layers, {
        layerId: `proof-${index}`,
        type: "proof",
        x,
        y: top,
        width: Math.max(proof.length * 7 + 18, 140),
        height: 16,
        color: decision.selected.palette.text,
        text: proof,
        opacity: 1
      });
    });
    ctx.restore();
  }

  private drawEmotionMeter(
    ctx: Canvas2DLike,
    x: number,
    y: number,
    width: number,
    decision: AdaptiveCreativeDecision,
    layers: CompositionLayer[]
  ): void {
    ctx.save();
    ctx.fillStyle = withAlpha(decision.selected.palette.surface, 0.6);
    ctx.fillRect(x, y, width, 44);
    ctx.strokeStyle = decision.selected.palette.border;
    ctx.strokeRect(x, y, width, 44);
    ctx.fillStyle = decision.selected.palette.text;
    ctx.font = "bold 12px sans-serif";
    ctx.fillText(`Emotion: ${decision.emotion.primaryEmotion}`, x + 12, y + 10);
    const barX = x + 12;
    const barY = y + 28;
    const barWidth = width - 24;
    ctx.fillStyle = withAlpha(decision.selected.palette.text, 0.16);
    ctx.fillRect(barX, barY, barWidth, 8);
    ctx.fillStyle = decision.selected.palette.accent;
    ctx.fillRect(barX, barY, barWidth * decision.emotion.confidence, 8);
    pushLayer(layers, {
      layerId: "emotion-meter",
      type: "meter",
      x,
      y,
      width,
      height: 44,
      color: decision.selected.palette.accent,
      text: `${decision.emotion.primaryEmotion} ${(decision.emotion.confidence * 100).toFixed(1)}%`,
      opacity: 0.6
    });
    ctx.restore();
  }

  private drawCta(
    ctx: Canvas2DLike,
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    decision: AdaptiveCreativeDecision,
    layers: CompositionLayer[]
  ): void {
    ctx.save();
    ctx.fillStyle = decision.selected.palette.accent;
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = withAlpha(decision.selected.palette.accent, 0.68);
    ctx.strokeRect(x, y, width, height);
    ctx.fillStyle = decision.selected.palette.ctaText;
    ctx.font = "bold 16px sans-serif";
    ctx.fillText(label, x + 18, y + 14);
    pushLayer(layers, {
      layerId: "cta",
      type: "cta",
      x,
      y,
      width,
      height,
      color: decision.selected.palette.accent,
      text: label,
      opacity: 1
    });
    ctx.restore();
  }

  private drawFooter(
    ctx: Canvas2DLike,
    x: number,
    y: number,
    footer: string,
    decision: AdaptiveCreativeDecision,
    layers: CompositionLayer[]
  ): void {
    ctx.save();
    ctx.font = "11px sans-serif";
    ctx.fillStyle = decision.selected.palette.mutedText;
    ctx.fillText(footer, x, y);
    pushLayer(layers, {
      layerId: "footer",
      type: "footer",
      x,
      y,
      width: footer.length * 6,
      height: 12,
      color: decision.selected.palette.mutedText,
      text: footer,
      opacity: 0.9
    });
    ctx.restore();
  }
}
