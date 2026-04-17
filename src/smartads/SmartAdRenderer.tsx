import { ReactElement } from "react";
import {
  AdaptiveCreativeDecision,
  SmartAdComposition,
  SmartAdRenderModel,
  SmartAdRequest,
  formatCurrency,
  round
} from "./types";

export interface SmartAdRendererProps {
  request: SmartAdRequest;
  decision: AdaptiveCreativeDecision;
  composition: SmartAdComposition;
}

const toneToColor = (tone: "accent" | "surface" | "positive" | "warning" | "neutral", accent: string): string => {
  switch (tone) {
    case "accent":
      return accent;
    case "positive":
      return "#80ed99";
    case "warning":
      return "#ffd166";
    case "surface":
      return "rgba(255,255,255,0.08)";
    default:
      return "rgba(255,255,255,0.12)";
  }
};

export const buildSmartAdRenderModel = ({
  request,
  decision,
  composition
}: SmartAdRendererProps): SmartAdRenderModel => {
  const accent = decision.selected.palette.accent;
  const badges = composition.badges.map((badge, index) => ({
    id: `badge-${index}`,
    label: badge,
    tone: index === 0 ? "accent" : badge.toLowerCase().includes("save") ? "warning" : "surface"
  })) as SmartAdRenderModel["badges"];
  const metrics = [
    {
      id: "emotion",
      label: "Emotion",
      value: `${decision.emotion.primaryEmotion} ${(decision.emotion.confidence * 100).toFixed(1)}%`
    },
    {
      id: "attention",
      label: "Attention",
      value: decision.emotion.attentionBand
    },
    {
      id: "price",
      label: "Price",
      value: formatCurrency(request.product.price, request.product.currency)
    },
    {
      id: "bid-modifier",
      label: "Bid modifier",
      value: `${round(decision.recommendedBidModifier, 2)}x`
    }
  ];

  return {
    containerStyle: {
      width: composition.width,
      minHeight: composition.height,
      display: "grid",
      gap: 16,
      background: decision.selected.palette.background,
      color: decision.selected.palette.text,
      borderRadius: 20,
      padding: 20,
      border: `1px solid ${decision.selected.palette.border}`,
      boxShadow: `0 22px 60px ${decision.selected.palette.shadow}`,
      fontFamily: 'Inter, system-ui, sans-serif'
    },
    headerStyle: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 12
    },
    bodyStyle: {
      display: "grid",
      gap: 12,
      lineHeight: 1.45,
      color: decision.selected.palette.mutedText
    },
    ctaStyle: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "14px 20px",
      borderRadius: 14,
      background: decision.selected.palette.accent,
      color: decision.selected.palette.ctaText,
      fontWeight: 700,
      letterSpacing: "0.01em"
    },
    badgeStyle: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "6px 10px",
      borderRadius: 999,
      fontSize: 12,
      fontWeight: 700
    },
    footerStyle: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 12,
      color: decision.selected.palette.mutedText,
      fontSize: 12
    },
    headline: composition.headline,
    body: composition.body,
    ctaLabel: composition.ctaLabel,
    brandLabel: `${request.product.brandName} · ${decision.selected.layout}`,
    supportingText: decision.creativeStrategy.emphasis,
    badges,
    proofPoints: composition.proofPoints,
    metrics,
    accessibility: {
      role: "complementary",
      ariaLabel: composition.ariaLabel,
      altText: composition.altText
    }
  };
};

export const SmartAdRenderer = ({ request, decision, composition }: SmartAdRendererProps): ReactElement => {
  const model = buildSmartAdRenderModel({ request, decision, composition });

  return (
    <section
      role={model.accessibility.role}
      aria-label={model.accessibility.ariaLabel}
      style={model.containerStyle}
      data-smart-ad={decision.selected.creativeId}
    >
      <header style={model.headerStyle}>
        <div>
          <div style={{ fontSize: 12, color: decision.selected.palette.mutedText }}>{model.brandLabel}</div>
          <h2 style={{ margin: "8px 0 0", fontSize: 30, lineHeight: 1.08 }}>{model.headline}</h2>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12, color: decision.selected.palette.mutedText }}>Adaptive state</div>
          <strong>{decision.emotion.primaryEmotion}</strong>
        </div>
      </header>

      <div style={model.bodyStyle}>
        <p style={{ margin: 0 }}>{model.body}</p>
        <p style={{ margin: 0, color: decision.selected.palette.text }}>{model.supportingText}</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {model.badges.map((badge) => (
            <span
              key={badge.id}
              style={{
                ...model.badgeStyle,
                background: toneToColor(badge.tone, decision.selected.palette.accent),
                color: badge.tone === "accent" ? decision.selected.palette.ctaText : decision.selected.palette.text
              }}
            >
              {badge.label}
            </span>
          ))}
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, color: decision.selected.palette.text }}>
          {model.proofPoints.map((proof) => (
            <li key={proof}>{proof}</li>
          ))}
        </ul>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {model.metrics.map((metric) => (
          <article
            key={metric.id}
            style={{
              minWidth: 120,
              padding: 12,
              borderRadius: 14,
              background: decision.selected.palette.surface,
              border: `1px solid ${decision.selected.palette.border}`
            }}
          >
            <div style={{ fontSize: 11, color: decision.selected.palette.mutedText, textTransform: "uppercase" }}>{metric.label}</div>
            <strong>{metric.value}</strong>
          </article>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <a href={request.product.destinationUrl} style={{ ...model.ctaStyle, textDecoration: "none" }}>
          {model.ctaLabel}
        </a>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: decision.selected.palette.mutedText }}>
            <span>Confidence</span>
            <span>{(decision.emotion.confidence * 100).toFixed(1)}%</span>
          </div>
          <div style={{ marginTop: 8, height: 10, borderRadius: 999, background: "rgba(255,255,255,0.1)", overflow: "hidden" }}>
            <div
              style={{
                width: `${(decision.emotion.confidence * 100).toFixed(1)}%`,
                height: "100%",
                background: decision.selected.palette.accent
              }}
            />
          </div>
        </div>
      </div>

      <footer style={model.footerStyle}>
        <span>{composition.footer}</span>
        <span>{model.accessibility.altText}</span>
      </footer>
    </section>
  );
};
