import {
  AttentionSample,
  AttentionZone,
  HeatmapFrame,
  HeatmapLegendItem,
  HeatmapPaletteStop,
  HeatmapRenderStats,
  average,
  clamp,
  round
} from "./models";

export interface CanvasGradientLike {
  addColorStop(offset: number, color: string): void;
}

export interface Canvas2DLike {
  canvas: { width: number; height: number };
  globalAlpha: number;
  fillStyle: string | CanvasGradientLike;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textAlign: "left" | "center" | "right";
  textBaseline: "top" | "middle" | "bottom";
  save(): void;
  restore(): void;
  clearRect(x: number, y: number, width: number, height: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  strokeRect(x: number, y: number, width: number, height: number): void;
  beginPath(): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  fill(): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number
  ): CanvasGradientLike;
}

export interface HeatmapRendererScheduler {
  setInterval(handler: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface HeatmapRendererOptions {
  palette: HeatmapPaletteStop[];
  zoneStrokeColor: string;
  zoneLabelColor: string;
  gridColor: string;
  backgroundColor: string;
  overlayAlpha: number;
  legendWidth: number;
  annotationColor: string;
  title: string;
  refreshIntervalMs: number;
  maxPointRadius: number;
  minPointRadius: number;
  drawGrid: boolean;
  drawLegend: boolean;
  drawZoneLabels: boolean;
}

export interface HeatmapRendererFrameSnapshot {
  frameId: string;
  title: string;
  legend: HeatmapLegendItem[];
  stats: HeatmapRenderStats;
  zones: Array<{
    zoneId: string;
    label: string;
    intensity: number;
    sampleCount: number;
  }>;
  normalizedSamples: Array<{
    sampleId: string;
    x: number;
    y: number;
    radius: number;
    intensity: number;
    color: string;
    zoneId?: string;
  }>;
}

const DEFAULT_PALETTE: HeatmapPaletteStop[] = [
  { offset: 0, color: "#061726", alpha: 0 },
  { offset: 0.15, color: "#0ea5e9", alpha: 0.24 },
  { offset: 0.4, color: "#22c55e", alpha: 0.42 },
  { offset: 0.7, color: "#f59e0b", alpha: 0.72 },
  { offset: 1, color: "#ef4444", alpha: 0.94 }
];

const DEFAULT_OPTIONS: HeatmapRendererOptions = {
  palette: DEFAULT_PALETTE,
  zoneStrokeColor: "rgba(255,255,255,0.24)",
  zoneLabelColor: "rgba(255,255,255,0.92)",
  gridColor: "rgba(255,255,255,0.08)",
  backgroundColor: "#050816",
  overlayAlpha: 0.92,
  legendWidth: 180,
  annotationColor: "rgba(255,255,255,0.88)",
  title: "BCI Attention Heatmap",
  refreshIntervalMs: 5000,
  maxPointRadius: 84,
  minPointRadius: 12,
  drawGrid: true,
  drawLegend: true,
  drawZoneLabels: true
};

const defaultScheduler: HeatmapRendererScheduler = {
  setInterval(handler, intervalMs) {
    return global.setInterval(handler, intervalMs);
  },
  clearInterval(handle) {
    global.clearInterval(handle as NodeJS.Timeout);
  }
};

const withinZone = (sample: AttentionSample, zone: AttentionZone): boolean => {
  return sample.x >= zone.x && sample.x <= zone.x + zone.width && sample.y >= zone.y && sample.y <= zone.y + zone.height;
};

const colorWithAlpha = (hexColor: string, alpha: number): string => {
  const value = hexColor.replace("#", "");
  const normalized = value.length === 3
    ? value.split("").map((char) => `${char}${char}`).join("")
    : value.padEnd(6, "0").slice(0, 6);
  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${round(alpha, 3)})`;
};

const interpolateColor = (palette: HeatmapPaletteStop[], value: number): string => {
  const clamped = clamp(value, 0, 1);
  const stops = [...palette].sort((left, right) => left.offset - right.offset);

  if (clamped <= stops[0]?.offset) {
    return colorWithAlpha(stops[0]?.color ?? "#000000", stops[0]?.alpha ?? 1);
  }

  for (let index = 1; index < stops.length; index += 1) {
    const previous = stops[index - 1];
    const current = stops[index];
    if (clamped <= current.offset) {
      const span = Math.max(current.offset - previous.offset, 0.0001);
      const local = (clamped - previous.offset) / span;
      const alpha = previous.alpha + (current.alpha - previous.alpha) * local;
      return colorWithAlpha(current.color, alpha);
    }
  }

  const last = stops[stops.length - 1];
  return colorWithAlpha(last?.color ?? "#ffffff", last?.alpha ?? 1);
};

const buildLegend = (palette: HeatmapPaletteStop[]): HeatmapLegendItem[] => {
  return [...palette]
    .sort((left, right) => left.offset - right.offset)
    .map((stop) => ({
      label: `${round(stop.offset * 100, 0)}%`,
      color: colorWithAlpha(stop.color, stop.alpha),
      value: stop.offset
    }));
};

const normalizeSample = (
  sample: AttentionSample,
  frame: HeatmapFrame,
  options: HeatmapRendererOptions
): HeatmapRendererFrameSnapshot["normalizedSamples"][number] => {
  const intensity = clamp((sample.intensity + sample.attentionScore + sample.focusScore) / 3, 0, 1);
  const radius = round(options.minPointRadius + (options.maxPointRadius - options.minPointRadius) * intensity, 2);
  return {
    sampleId: sample.sampleId,
    x: clamp(sample.x, 0, frame.width),
    y: clamp(sample.y, 0, frame.height),
    radius,
    intensity,
    color: interpolateColor(options.palette, intensity),
    zoneId: sample.zoneId
  };
};

const computeZoneMetrics = (
  frame: HeatmapFrame,
  normalizedSamples: HeatmapRendererFrameSnapshot["normalizedSamples"]
): HeatmapRendererFrameSnapshot["zones"] => {
  return frame.zones.map((zone) => {
    const zoneSamples = normalizedSamples.filter((sample) => {
      const matchingSource = frame.samples.find((candidate) => candidate.sampleId === sample.sampleId);
      return matchingSource ? withinZone(matchingSource, zone) : false;
    });
    return {
      zoneId: zone.id,
      label: zone.label,
      intensity: round(average(zoneSamples.map((sample) => sample.intensity)), 4),
      sampleCount: zoneSamples.length
    };
  });
};

const computeHottestZone = (
  zones: HeatmapRendererFrameSnapshot["zones"]
): { zoneId: string | null; zoneLabel: string | null } => {
  const hottest = [...zones].sort((left, right) => right.intensity - left.intensity || right.sampleCount - left.sampleCount)[0];
  return {
    zoneId: hottest?.zoneId ?? null,
    zoneLabel: hottest?.label ?? null
  };
};

export class AttentionHeatmapRenderer {
  private readonly ctx: Canvas2DLike;
  private readonly options: HeatmapRendererOptions;
  private readonly scheduler: HeatmapRendererScheduler;
  private frames: HeatmapFrame[] = [];
  private liveHandle: unknown;
  private frameIndex = 0;
  private lastSnapshot: HeatmapRendererFrameSnapshot | null = null;

  constructor(
    ctx: Canvas2DLike,
    options: Partial<HeatmapRendererOptions> = {},
    scheduler: HeatmapRendererScheduler = defaultScheduler
  ) {
    this.ctx = ctx;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.scheduler = scheduler;
  }

  setFrames(frames: HeatmapFrame[]): HeatmapRendererFrameSnapshot | null {
    this.frames = [...frames];
    this.frameIndex = 0;
    if (!this.frames.length) {
      this.lastSnapshot = null;
      return null;
    }
    return this.renderFrame(0);
  }

  appendFrame(frame: HeatmapFrame): HeatmapRendererFrameSnapshot {
    this.frames.push(frame);
    this.frameIndex = this.frames.length - 1;
    return this.renderLatest();
  }

  replaceFrame(frameId: string, frame: HeatmapFrame): HeatmapRendererFrameSnapshot {
    const index = this.frames.findIndex((existing) => existing.frameId === frameId);
    if (index === -1) {
      throw new Error(`Unknown heatmap frame ${frameId}`);
    }
    this.frames[index] = frame;
    this.frameIndex = index;
    return this.renderFrame(index);
  }

  renderLatest(): HeatmapRendererFrameSnapshot {
    if (!this.frames.length) {
      throw new Error("No heatmap frames loaded");
    }
    return this.renderFrame(this.frames.length - 1);
  }

  renderFrame(index: number): HeatmapRendererFrameSnapshot {
    const frame = this.frames[index];
    if (!frame) {
      throw new Error(`No heatmap frame found at index ${index}`);
    }

    this.frameIndex = index;
    this.prepareCanvas(frame);
    const normalizedSamples = frame.samples.map((sample) => normalizeSample(sample, frame, this.options));
    const zones = computeZoneMetrics(frame, normalizedSamples);
    const stats = this.buildStats(frame, normalizedSamples, zones);
    const snapshot: HeatmapRendererFrameSnapshot = {
      frameId: frame.frameId,
      title: this.options.title,
      legend: buildLegend(this.options.palette),
      stats,
      zones,
      normalizedSamples
    };

    this.drawBackdrop(frame);
    if (this.options.drawGrid) {
      this.drawGrid(frame);
    }
    this.drawZones(frame, zones);
    this.drawSamples(snapshot);
    this.drawFocusBar(snapshot.stats.attentionMomentum.current, frame);
    this.drawMomentumBadge(snapshot.stats, frame);
    if (this.options.drawLegend) {
      this.drawLegend(snapshot.legend, frame);
    }
    this.drawTitle(frame, snapshot.stats);

    this.lastSnapshot = snapshot;
    return snapshot;
  }

  startLiveMode(): void {
    if (this.liveHandle) {
      return;
    }
    this.liveHandle = this.scheduler.setInterval(() => {
      if (!this.frames.length) {
        return;
      }
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
      this.renderFrame(this.frameIndex);
    }, this.options.refreshIntervalMs);
  }

  stopLiveMode(): void {
    if (!this.liveHandle) {
      return;
    }
    this.scheduler.clearInterval(this.liveHandle);
    this.liveHandle = undefined;
  }

  isLive(): boolean {
    return Boolean(this.liveHandle);
  }

  getLastSnapshot(): HeatmapRendererFrameSnapshot | null {
    return this.lastSnapshot ? JSON.parse(JSON.stringify(this.lastSnapshot)) as HeatmapRendererFrameSnapshot : null;
  }

  getFrames(): HeatmapFrame[] {
    return JSON.parse(JSON.stringify(this.frames)) as HeatmapFrame[];
  }

  describeCurrentFrame(): string {
    if (!this.lastSnapshot) {
      return "No frame rendered";
    }

    const hottestZone = this.lastSnapshot.stats.hottestZoneLabel ?? "none";
    return `${this.lastSnapshot.title}: ${this.lastSnapshot.stats.sampleCount} samples, hottest zone ${hottestZone}, momentum ${this.lastSnapshot.stats.attentionMomentum.direction}.`;
  }

  private prepareCanvas(frame: HeatmapFrame): void {
    this.ctx.canvas.width = frame.width;
    this.ctx.canvas.height = frame.height;
    this.ctx.globalAlpha = 1;
    this.ctx.lineWidth = 1;
    this.ctx.textAlign = "left";
    this.ctx.textBaseline = "top";
    this.ctx.font = "12px monospace";
  }

  private buildStats(
    frame: HeatmapFrame,
    normalizedSamples: HeatmapRendererFrameSnapshot["normalizedSamples"],
    zones: HeatmapRendererFrameSnapshot["zones"]
  ): HeatmapRenderStats {
    const hottest = computeHottestZone(zones);
    return {
      frameId: frame.frameId,
      renderedAt: new Date().toISOString(),
      sampleCount: normalizedSamples.length,
      averageIntensity: round(average(normalizedSamples.map((sample) => sample.intensity)), 4),
      hottestZoneId: hottest.zoneId,
      hottestZoneLabel: hottest.zoneLabel,
      attentionMomentum: frame.momentum
    };
  }

  private drawBackdrop(frame: HeatmapFrame): void {
    this.ctx.save();
    this.ctx.clearRect(0, 0, frame.width, frame.height);
    this.ctx.fillStyle = this.options.backgroundColor;
    this.ctx.fillRect(0, 0, frame.width, frame.height);
    this.ctx.restore();
  }

  private drawGrid(frame: HeatmapFrame): void {
    this.ctx.save();
    this.ctx.strokeStyle = this.options.gridColor;
    this.ctx.lineWidth = 1;
    const stepX = Math.max(Math.floor(frame.width / 8), 40);
    const stepY = Math.max(Math.floor(frame.height / 6), 32);

    for (let x = 0; x <= frame.width; x += stepX) {
      this.ctx.strokeRect(x, 0, 1, frame.height);
    }
    for (let y = 0; y <= frame.height; y += stepY) {
      this.ctx.strokeRect(0, y, frame.width, 1);
    }
    this.ctx.restore();
  }

  private drawZones(
    frame: HeatmapFrame,
    zones: HeatmapRendererFrameSnapshot["zones"]
  ): void {
    this.ctx.save();
    this.ctx.strokeStyle = this.options.zoneStrokeColor;
    this.ctx.lineWidth = 1.5;
    this.ctx.font = "11px monospace";

    for (const zone of frame.zones) {
      const metrics = zones.find((entry) => entry.zoneId === zone.id);
      const intensity = metrics?.intensity ?? 0;
      const overlay = colorWithAlpha("#ffffff", clamp(intensity * 0.25, 0.04, 0.22));
      this.ctx.fillStyle = overlay;
      this.ctx.fillRect(zone.x, zone.y, zone.width, zone.height);
      this.ctx.strokeRect(zone.x, zone.y, zone.width, zone.height);

      if (this.options.drawZoneLabels) {
        this.ctx.fillStyle = this.options.zoneLabelColor;
        this.ctx.fillText(`${zone.label} · ${round(intensity * 100, 1)}%`, zone.x + 6, zone.y + 6);
      }
    }

    this.ctx.restore();
  }

  private drawSamples(snapshot: HeatmapRendererFrameSnapshot): void {
    this.ctx.save();

    for (const sample of snapshot.normalizedSamples) {
      const gradient = this.ctx.createRadialGradient(sample.x, sample.y, 0, sample.x, sample.y, sample.radius);
      gradient.addColorStop(0, sample.color);
      gradient.addColorStop(0.5, sample.color);
      gradient.addColorStop(1, colorWithAlpha("#000000", 0));
      this.ctx.fillStyle = gradient;
      this.ctx.globalAlpha = this.options.overlayAlpha;
      this.ctx.beginPath();
      this.ctx.arc(sample.x, sample.y, sample.radius, 0, Math.PI * 2);
      this.ctx.fill();
    }

    this.ctx.restore();
  }

  private drawFocusBar(attentionValue: number, frame: HeatmapFrame): void {
    this.ctx.save();
    const width = frame.width - this.options.legendWidth - 32;
    const clamped = clamp(attentionValue, 0, 1);
    this.ctx.fillStyle = colorWithAlpha("#0f172a", 0.8);
    this.ctx.fillRect(16, frame.height - 26, width, 10);
    this.ctx.fillStyle = interpolateColor(this.options.palette, clamped);
    this.ctx.fillRect(16, frame.height - 26, width * clamped, 10);
    this.ctx.fillStyle = this.options.annotationColor;
    this.ctx.fillText(`Attention ${round(clamped * 100, 1)}%`, 16, frame.height - 42);
    this.ctx.restore();
  }

  private drawMomentumBadge(stats: HeatmapRenderStats, frame: HeatmapFrame): void {
    this.ctx.save();
    const badgeWidth = 120;
    const badgeHeight = 46;
    const x = frame.width - this.options.legendWidth - badgeWidth - 16;
    const y = 16;
    this.ctx.fillStyle = colorWithAlpha("#111827", 0.82);
    this.ctx.fillRect(x, y, badgeWidth, badgeHeight);
    this.ctx.strokeStyle = colorWithAlpha("#ffffff", 0.16);
    this.ctx.strokeRect(x, y, badgeWidth, badgeHeight);
    this.ctx.fillStyle = this.options.annotationColor;
    this.ctx.fillText(`Momentum ${stats.attentionMomentum.direction}`, x + 8, y + 8);
    this.ctx.fillText(`${round(stats.attentionMomentum.deltaPercent, 1)}% delta`, x + 8, y + 24);
    this.ctx.restore();
  }

  private drawLegend(legend: HeatmapLegendItem[], frame: HeatmapFrame): void {
    const x = frame.width - this.options.legendWidth;
    const y = 0;
    this.ctx.save();
    this.ctx.fillStyle = colorWithAlpha("#020617", 0.92);
    this.ctx.fillRect(x, y, this.options.legendWidth, frame.height);
    this.ctx.fillStyle = this.options.annotationColor;
    this.ctx.fillText("Legend", x + 12, 16);

    legend.forEach((item, index) => {
      const top = 46 + index * 34;
      this.ctx.fillStyle = item.color;
      this.ctx.fillRect(x + 12, top, 24, 16);
      this.ctx.fillStyle = this.options.annotationColor;
      this.ctx.fillText(`${item.label} intensity`, x + 44, top + 1);
    });

    if (this.lastSnapshot) {
      const statsTop = frame.height - 110;
      this.ctx.fillStyle = this.options.annotationColor;
      this.ctx.fillText(`Samples ${this.lastSnapshot.stats.sampleCount}`, x + 12, statsTop);
      this.ctx.fillText(`Avg ${round(this.lastSnapshot.stats.averageIntensity * 100, 1)}%`, x + 12, statsTop + 18);
      this.ctx.fillText(`Hot ${this.lastSnapshot.stats.hottestZoneLabel ?? "none"}`, x + 12, statsTop + 36);
      this.ctx.fillText(`Refresh ${Math.round(frame.refreshIntervalMs / 1000)}s`, x + 12, statsTop + 54);
    }

    this.ctx.restore();
  }

  private drawTitle(frame: HeatmapFrame, stats: HeatmapRenderStats): void {
    this.ctx.save();
    this.ctx.fillStyle = this.options.annotationColor;
    this.ctx.font = "14px monospace";
    this.ctx.fillText(`${this.options.title} · ${frame.campaignId}`, 16, 12);
    this.ctx.font = "11px monospace";
    this.ctx.fillText(`Segment ${frame.segmentId} · Hottest zone ${stats.hottestZoneLabel ?? "none"}`, 16, 32);
    this.ctx.restore();
  }
}

export const createHeatmapFrame = (input: {
  frameId: string;
  campaignId: string;
  segmentId: string;
  width: number;
  height: number;
  samples: AttentionSample[];
  zones: AttentionZone[];
  refreshIntervalMs?: number;
  previousAttention?: number;
}): HeatmapFrame => {
  const currentAttention = average(input.samples.map((sample) => sample.attentionScore));
  const previousAttention = input.previousAttention ?? currentAttention;
  return {
    frameId: input.frameId,
    campaignId: input.campaignId,
    segmentId: input.segmentId,
    width: input.width,
    height: input.height,
    refreshIntervalMs: input.refreshIntervalMs ?? DEFAULT_OPTIONS.refreshIntervalMs,
    capturedAt: new Date().toISOString(),
    samples: input.samples,
    zones: input.zones,
    momentum: {
      current: round(currentAttention, 4),
      previous: round(previousAttention, 4),
      delta: round(currentAttention - previousAttention, 4),
      deltaPercent: previousAttention === 0 ? 0 : round(((currentAttention - previousAttention) / previousAttention) * 100, 2),
      direction: currentAttention > previousAttention + 0.01 ? "up" : currentAttention < previousAttention - 0.01 ? "down" : "flat"
    }
  };
};

export const describeHeatmapSnapshot = (snapshot: HeatmapRendererFrameSnapshot): string => {
  const hottestZone = snapshot.stats.hottestZoneLabel ?? "none";
  return `${snapshot.title} frame ${snapshot.frameId}: ${snapshot.stats.sampleCount} samples, hottest zone ${hottestZone}, avg intensity ${round(snapshot.stats.averageIntensity * 100, 1)}%.`;
};
