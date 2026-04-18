interface BidWarRoomPageOptions {
  advertiserId: string;
  token: string;
}

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const getBidWarRoomHtml = ({ advertiserId, token }: BidWarRoomPageOptions): string => {
  const safeAdvertiserId = escapeHtml(advertiserId);
  const safeToken = encodeURIComponent(token);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Quantads Bid War Room</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #030814;
        --bg-2: #071022;
        --surface: rgba(10, 19, 36, 0.88);
        --surface-strong: rgba(17, 31, 58, 0.96);
        --surface-soft: rgba(18, 36, 66, 0.72);
        --border: rgba(110, 166, 255, 0.16);
        --border-strong: rgba(110, 166, 255, 0.32);
        --text: #eef5ff;
        --muted: #9db3d5;
        --accent: #51d3ff;
        --accent-2: #8ef2a9;
        --accent-3: #ffd166;
        --danger: #ff7b7b;
        --danger-2: #ff4d80;
        --warning: #ffbd59;
        --violet: #8d7cff;
        --grid: rgba(122, 171, 255, 0.12);
        --shadow: 0 22px 50px rgba(0, 0, 0, 0.32);
        --shadow-soft: 0 14px 34px rgba(0, 0, 0, 0.18);
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      * {
        box-sizing: border-box;
      }
      html,
      body {
        margin: 0;
        min-height: 100%;
        background:
          radial-gradient(circle at top left, rgba(81, 211, 255, 0.18), transparent 28%),
          radial-gradient(circle at top right, rgba(141, 124, 255, 0.16), transparent 26%),
          radial-gradient(circle at bottom center, rgba(142, 242, 169, 0.1), transparent 26%),
          linear-gradient(180deg, var(--bg), var(--bg-2) 58%, #030611);
        color: var(--text);
      }
      body {
        display: flex;
        flex-direction: column;
      }
      a {
        color: inherit;
      }
      .shell {
        width: min(1600px, calc(100vw - 32px));
        margin: 0 auto;
      }
      header {
        position: sticky;
        top: 0;
        z-index: 40;
        backdrop-filter: blur(24px);
        background: rgba(3, 8, 20, 0.72);
        border-bottom: 1px solid rgba(110, 166, 255, 0.12);
      }
      .header-inner {
        display: grid;
        grid-template-columns: 1.2fr 0.8fr;
        gap: 18px;
        padding: 28px 0 22px;
        align-items: end;
      }
      .hero h1 {
        margin: 0;
        font-size: 34px;
        line-height: 1.05;
        letter-spacing: -0.02em;
      }
      .hero p {
        margin: 10px 0 0;
        max-width: 900px;
        color: var(--muted);
        font-size: 15px;
        line-height: 1.65;
      }
      .status-grid {
        display: grid;
        gap: 12px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .status-card {
        padding: 14px 16px;
        border-radius: 18px;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.02));
        border: 1px solid var(--border);
        box-shadow: var(--shadow-soft);
      }
      .status-card strong {
        display: block;
        font-size: 13px;
        color: var(--muted);
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .status-card span {
        display: block;
        margin-top: 8px;
        font-size: 18px;
        font-weight: 700;
      }
      .pill-bar {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 16px;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 9px 14px;
        border-radius: 999px;
        background: rgba(81, 211, 255, 0.12);
        border: 1px solid rgba(81, 211, 255, 0.2);
        font-size: 13px;
        color: var(--text);
      }
      .pill::before {
        content: "";
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: currentColor;
        opacity: 0.85;
      }
      .pill.success {
        color: var(--accent-2);
        background: rgba(142, 242, 169, 0.12);
        border-color: rgba(142, 242, 169, 0.22);
      }
      .pill.warning {
        color: var(--warning);
        background: rgba(255, 189, 89, 0.12);
        border-color: rgba(255, 189, 89, 0.22);
      }
      .pill.danger {
        color: var(--danger);
        background: rgba(255, 123, 123, 0.12);
        border-color: rgba(255, 123, 123, 0.22);
      }
      main {
        flex: 1;
        padding: 24px 0 42px;
      }
      .layout {
        display: grid;
        gap: 22px;
      }
      .summary-grid {
        display: grid;
        gap: 16px;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      }
      .card {
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.015));
        border: 1px solid var(--border);
        border-radius: 22px;
        box-shadow: var(--shadow);
      }
      .metric-card {
        padding: 18px;
        position: relative;
        overflow: hidden;
      }
      .metric-card::after {
        content: "";
        position: absolute;
        inset: auto -50px -80px auto;
        width: 120px;
        height: 120px;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(81, 211, 255, 0.18), transparent 70%);
      }
      .metric-card .label {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--muted);
      }
      .metric-card .value {
        margin-top: 12px;
        font-size: 32px;
        font-weight: 700;
        letter-spacing: -0.02em;
      }
      .metric-card .sub {
        margin-top: 8px;
        font-size: 13px;
        color: var(--muted);
        line-height: 1.55;
      }
      .top-grid {
        display: grid;
        gap: 22px;
        grid-template-columns: minmax(0, 1.45fr) minmax(360px, 0.9fr);
      }
      .panel {
        padding: 22px;
      }
      .panel-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
        margin-bottom: 16px;
      }
      .panel-header h2,
      .panel-header h3 {
        margin: 0;
        font-size: 22px;
      }
      .panel-header p {
        margin: 7px 0 0;
        color: var(--muted);
        font-size: 14px;
        line-height: 1.6;
        max-width: 760px;
      }
      .canvas-shell {
        position: relative;
        min-height: 420px;
        border-radius: 20px;
        overflow: hidden;
        border: 1px solid rgba(110, 166, 255, 0.12);
        background:
          linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01)),
          radial-gradient(circle at top left, rgba(81, 211, 255, 0.08), transparent 26%);
      }
      .canvas-shell.short {
        min-height: 280px;
      }
      canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
      .chart-toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: center;
        margin-bottom: 16px;
      }
      .toolbar-pill {
        padding: 8px 12px;
        border-radius: 999px;
        border: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.04);
        color: var(--muted);
        font-size: 13px;
      }
      .toolbar-pill strong {
        color: var(--text);
      }
      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: 18px;
        font-size: 13px;
        color: var(--muted);
      }
      .legend-item {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      .legend-item::before {
        content: "";
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: var(--accent);
      }
      .legend-item.secondary::before {
        background: var(--accent-2);
      }
      .legend-item.warning::before {
        background: var(--warning);
      }
      .legend-item.danger::before {
        background: var(--danger);
      }
      .legend-item.violet::before {
        background: var(--violet);
      }
      .right-stack {
        display: grid;
        gap: 22px;
      }
      .gauge-grid {
        display: grid;
        gap: 14px;
      }
      .gauge-row {
        display: grid;
        gap: 8px;
      }
      .gauge-row header {
        position: static;
        padding: 0;
        background: transparent;
        border: 0;
        backdrop-filter: none;
      }
      .gauge-title {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 13px;
        color: var(--muted);
      }
      .gauge-track {
        width: 100%;
        height: 12px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.04);
      }
      .gauge-fill {
        height: 100%;
        border-radius: 999px;
        background: linear-gradient(90deg, var(--accent), var(--accent-2));
        width: 0;
      }
      .gauge-fill.warning {
        background: linear-gradient(90deg, var(--warning), #ff8a48);
      }
      .gauge-fill.danger {
        background: linear-gradient(90deg, var(--danger), var(--danger-2));
      }
      .middle-grid {
        display: grid;
        gap: 22px;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      }
      .triple-grid {
        display: grid;
        gap: 22px;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
      }
      .control-grid {
        display: grid;
        gap: 14px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .field {
        display: grid;
        gap: 8px;
      }
      .field label {
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .field input,
      .field select {
        width: 100%;
        padding: 11px 12px;
        border-radius: 14px;
        border: 1px solid rgba(110, 166, 255, 0.18);
        background: rgba(6, 15, 29, 0.82);
        color: var(--text);
        outline: none;
      }
      .field input[type="range"] {
        padding: 0;
        height: 34px;
        border: 0;
        background: transparent;
      }
      .range-label {
        display: flex;
        justify-content: space-between;
        color: var(--muted);
        font-size: 12px;
      }
      .button-row {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        margin-top: 8px;
      }
      button {
        appearance: none;
        border: 0;
        border-radius: 14px;
        padding: 12px 16px;
        font-weight: 700;
        color: #06101f;
        background: linear-gradient(135deg, var(--accent), var(--accent-2));
        cursor: pointer;
      }
      button.secondary {
        color: var(--text);
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }
      button.warning {
        color: #261403;
        background: linear-gradient(135deg, var(--warning), #ffa65a);
      }
      .result-banner {
        margin-top: 16px;
        padding: 14px 16px;
        border-radius: 16px;
        background: rgba(81, 211, 255, 0.1);
        border: 1px solid rgba(81, 211, 255, 0.18);
        color: var(--text);
        font-size: 14px;
        line-height: 1.65;
      }
      .empty-state {
        display: grid;
        place-items: center;
        min-height: 220px;
        text-align: center;
        color: var(--muted);
        padding: 22px;
      }
      .table-wrap {
        overflow-x: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th,
      td {
        padding: 12px 10px;
        border-bottom: 1px solid rgba(110, 166, 255, 0.08);
        text-align: left;
        font-size: 14px;
        vertical-align: top;
      }
      th {
        color: var(--muted);
        font-weight: 600;
      }
      tbody tr:hover td {
        background: rgba(255, 255, 255, 0.02);
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .chip.ready {
        color: var(--accent-2);
        background: rgba(142, 242, 169, 0.12);
      }
      .chip.watch {
        color: var(--warning);
        background: rgba(255, 189, 89, 0.12);
      }
      .chip.hold {
        color: var(--danger);
        background: rgba(255, 123, 123, 0.12);
      }
      .stack {
        display: grid;
        gap: 14px;
      }
      .info-card {
        padding: 16px;
        border-radius: 18px;
        border: 1px solid rgba(110, 166, 255, 0.14);
        background: rgba(255, 255, 255, 0.025);
      }
      .info-card h4 {
        margin: 0;
        font-size: 16px;
      }
      .info-card p {
        margin: 8px 0 0;
        color: var(--muted);
        font-size: 13px;
        line-height: 1.6;
      }
      .mini-metrics {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        margin-top: 12px;
      }
      .mini-metric {
        padding: 12px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.04);
      }
      .mini-metric strong {
        display: block;
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted);
      }
      .mini-metric span {
        display: block;
        margin-top: 6px;
        font-weight: 700;
        font-size: 18px;
      }
      .event-stream {
        max-height: 520px;
        overflow: auto;
        display: grid;
        gap: 12px;
      }
      .event-item {
        padding: 14px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.025);
        border: 1px solid rgba(110, 166, 255, 0.1);
      }
      .event-item header {
        position: static;
        padding: 0;
        background: transparent;
        border: 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
      }
      .event-item strong {
        font-size: 15px;
      }
      .event-item p {
        margin: 10px 0 0;
        font-size: 13px;
        color: var(--muted);
        line-height: 1.55;
      }
      .event-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 12px;
      }
      .tag {
        padding: 5px 10px;
        border-radius: 999px;
        border: 1px solid rgba(110, 166, 255, 0.18);
        color: var(--muted);
        font-size: 12px;
      }
      .footer-note {
        color: var(--muted);
        font-size: 13px;
        line-height: 1.6;
      }
      @media (max-width: 1280px) {
        .header-inner,
        .top-grid,
        .middle-grid,
        .triple-grid {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 860px) {
        .shell {
          width: min(100vw - 18px, 1600px);
        }
        .control-grid {
          grid-template-columns: 1fr;
        }
        .status-grid {
          grid-template-columns: 1fr;
        }
        .mini-metrics {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <header>
      <div class="shell header-inner">
        <div class="hero">
          <h1>Quantads Bid War Visualization</h1>
          <p>
            Auction War Room for advertiser <strong>${safeAdvertiserId}</strong>. Canvas candlestick charts track bid momentum,
            sniper mode highlights last-second strike windows, CompetitorIntelligence estimates rival moves with regression,
            and BidStrategyAI auto-optimizer recommends the next bid that preserves margin and win quality.
          </p>
          <div class="pill-bar">
            <span class="pill success" id="connection-pill">Connecting to exchange stream</span>
            <span class="pill" id="refresh-pill">Waiting for first snapshot</span>
            <span class="pill warning" id="sniper-pill">Sniper mode idle</span>
            <span class="pill danger" id="risk-pill">Risk pulse loading</span>
          </div>
        </div>
        <div class="status-grid">
          <div class="status-card">
            <strong>Best window</strong>
            <span id="header-best-window">Awaiting data</span>
          </div>
          <div class="status-card">
            <strong>Recommended strike</strong>
            <span id="header-strike">$0.00</span>
          </div>
          <div class="status-card">
            <strong>Competitor regression</strong>
            <span id="header-regression">0 profiles</span>
          </div>
          <div class="status-card">
            <strong>AI confidence</strong>
            <span id="header-ai-confidence">0%</span>
          </div>
        </div>
      </div>
    </header>

    <main>
      <div class="shell layout">
        <section class="summary-grid" id="summary-grid"></section>

        <section class="top-grid">
          <article class="card panel">
            <div class="panel-header">
              <div>
                <h2>Bid War Visualization</h2>
                <p>
                  Canvas candlestick chart of ranked bid movement, average clearing price, and pressure index. The overlay is tuned
                  for real-time auction swings so the operator can spot shrinking deltas before the field converges.
                </p>
              </div>
            </div>
            <div class="chart-toolbar">
              <span class="toolbar-pill"><strong id="chart-candles-count">0</strong> candles loaded</span>
              <span class="toolbar-pill"><strong id="chart-bid-range">$0.00</strong> active bid range</span>
              <span class="toolbar-pill"><strong id="chart-volatility">0.00</strong> average volatility</span>
              <span class="toolbar-pill"><strong id="chart-pressure">0.00</strong> pressure index</span>
            </div>
            <div class="legend">
              <span class="legend-item">Bid candle body</span>
              <span class="legend-item secondary">Average clearing price</span>
              <span class="legend-item warning">Pressure index</span>
              <span class="legend-item danger">Sniper trigger</span>
            </div>
            <div class="canvas-shell">
              <canvas id="candlestick-canvas" width="1200" height="420"></canvas>
            </div>
          </article>

          <aside class="right-stack">
            <section class="card panel">
              <div class="panel-header">
                <div>
                  <h3>Market Pulse</h3>
                  <p>
                    High-level gauges keep the operator aware of price stress, volatility, and sniper readiness without leaving the war room.
                  </p>
                </div>
              </div>
              <div class="gauge-grid">
                <div class="gauge-row">
                  <div class="gauge-title"><span>Pressure index</span><strong id="pulse-pressure-text">0.00</strong></div>
                  <div class="gauge-track"><div class="gauge-fill" id="pulse-pressure-fill"></div></div>
                </div>
                <div class="gauge-row">
                  <div class="gauge-title"><span>Volatility</span><strong id="pulse-volatility-text">0.00</strong></div>
                  <div class="gauge-track"><div class="gauge-fill warning" id="pulse-volatility-fill"></div></div>
                </div>
                <div class="gauge-row">
                  <div class="gauge-title"><span>Sniper readiness</span><strong id="pulse-sniper-text">0%</strong></div>
                  <div class="gauge-track"><div class="gauge-fill" id="pulse-sniper-fill"></div></div>
                </div>
                <div class="gauge-row">
                  <div class="gauge-title"><span>Margin spread</span><strong id="pulse-margin-text">$0.00</strong></div>
                  <div class="gauge-track"><div class="gauge-fill danger" id="pulse-margin-fill"></div></div>
                </div>
              </div>
            </section>

            <section class="card panel">
              <div class="panel-header">
                <div>
                  <h3>Sniper Mode Console</h3>
                  <p>
                    Use the same market LTV-aware optimizer as the API. Tune aggression and the allowed bid jump, then evaluate the current best window.
                  </p>
                </div>
              </div>
              <div class="control-grid">
                <div class="field">
                  <label for="sniper-base-price">Base outcome price</label>
                  <input id="sniper-base-price" type="number" min="0.01" step="0.01" value="10" />
                </div>
                <div class="field">
                  <label for="sniper-verified-ltv">Verified LTV</label>
                  <input id="sniper-verified-ltv" type="number" min="1" step="0.01" value="80" />
                </div>
                <div class="field">
                  <label for="sniper-intent">Intent score</label>
                  <input id="sniper-intent" type="number" min="0" max="1" step="0.01" value="0.7" />
                </div>
                <div class="field">
                  <label for="sniper-conversion">Conversion rate</label>
                  <input id="sniper-conversion" type="number" min="0" max="1" step="0.01" value="0.25" />
                </div>
                <div class="field">
                  <label for="sniper-attention">Attention score</label>
                  <input id="sniper-attention" type="number" min="0" max="1" step="0.01" value="0.82" />
                </div>
                <div class="field">
                  <label for="sniper-market-pressure">Market pressure</label>
                  <input id="sniper-market-pressure" type="number" min="0.8" max="1.6" step="0.01" value="1.08" />
                </div>
              </div>
              <div class="control-grid" style="margin-top: 14px;">
                <div class="field">
                  <label for="sniper-risk">Risk tolerance</label>
                  <input id="sniper-risk" type="number" min="0" max="1" step="0.01" value="0.3" />
                </div>
                <div class="field">
                  <label for="sniper-max-price">Max price</label>
                  <input id="sniper-max-price" type="number" min="0.01" step="0.01" value="24" />
                </div>
                <div class="field">
                  <label for="sniper-max-increment">Max increment</label>
                  <input id="sniper-max-increment" type="number" min="0.01" step="0.01" value="2.5" />
                </div>
                <div class="field">
                  <label for="sniper-auction">Auction target</label>
                  <select id="sniper-auction"></select>
                </div>
              </div>
              <div class="field" style="margin-top: 14px;">
                <label for="sniper-aggression">Aggression slider</label>
                <input id="sniper-aggression" type="range" min="0" max="1" step="0.01" value="0.58" />
                <div class="range-label"><span>Conservative</span><strong id="sniper-aggression-label">58%</strong><span>Strike now</span></div>
              </div>
              <div class="button-row">
                <button id="run-sniper-button">Run sniper mode</button>
                <button class="secondary" id="load-best-window-button">Load best window</button>
              </div>
              <div class="result-banner" id="sniper-result">
                Sniper mode result will appear here once a live auction window is available.
              </div>
            </section>
          </aside>
        </section>

        <section class="middle-grid">
          <article class="card panel">
            <div class="panel-header">
              <div>
                <h2>CompetitorIntelligence Regression</h2>
                <p>
                  Regression profiles infer competitor bid tendencies from reserve price, market pressure, attention lift, and leader gap.
                </p>
              </div>
            </div>
            <div class="legend">
              <span class="legend-item violet">Predicted next bid</span>
              <span class="legend-item secondary">Observed aggressiveness</span>
              <span class="legend-item warning">Confidence</span>
            </div>
            <div class="canvas-shell short">
              <canvas id="competitor-canvas" width="900" height="280"></canvas>
            </div>
            <div class="table-wrap" style="margin-top: 18px;">
              <table>
                <thead>
                  <tr>
                    <th>Competitor</th>
                    <th>Trend</th>
                    <th>Predicted bid</th>
                    <th>R²</th>
                    <th>Pressure β</th>
                    <th>Leader gap β</th>
                  </tr>
                </thead>
                <tbody id="competitor-table"></tbody>
              </table>
            </div>
          </article>

          <article class="card panel">
            <div class="panel-header">
              <div>
                <h2>BidStrategyAI Auto-Optimizer</h2>
                <p>
                  Request a fresh optimization pass for the active market. The engine starts from verified LTV pricing and layers margin,
                  budget, fraud, win-rate, and sniper constraints.
                </p>
              </div>
            </div>
            <div class="control-grid">
              <div class="field">
                <label for="ai-base-price">Base outcome price</label>
                <input id="ai-base-price" type="number" min="0.01" step="0.01" value="12" />
              </div>
              <div class="field">
                <label for="ai-verified-ltv">Verified LTV</label>
                <input id="ai-verified-ltv" type="number" min="1" step="0.01" value="92" />
              </div>
              <div class="field">
                <label for="ai-intent">Intent score</label>
                <input id="ai-intent" type="number" min="0" max="1" step="0.01" value="0.74" />
              </div>
              <div class="field">
                <label for="ai-conversion">Conversion rate</label>
                <input id="ai-conversion" type="number" min="0" max="1" step="0.01" value="0.29" />
              </div>
              <div class="field">
                <label for="ai-attention">Attention score</label>
                <input id="ai-attention" type="number" min="0" max="1" step="0.01" value="0.84" />
              </div>
              <div class="field">
                <label for="ai-market-pressure">Market pressure</label>
                <input id="ai-market-pressure" type="number" min="0.8" max="1.6" step="0.01" value="1.11" />
              </div>
              <div class="field">
                <label for="ai-risk">Risk tolerance</label>
                <input id="ai-risk" type="number" min="0" max="1" step="0.01" value="0.28" />
              </div>
              <div class="field">
                <label for="ai-competition-index">Competition index</label>
                <input id="ai-competition-index" type="number" min="0" max="1.5" step="0.01" value="0.75" />
              </div>
              <div class="field">
                <label for="ai-margin-guardrail">Margin guardrail</label>
                <input id="ai-margin-guardrail" type="number" min="0.05" max="0.9" step="0.01" value="0.24" />
              </div>
              <div class="field">
                <label for="ai-objective">Objective</label>
                <select id="ai-objective">
                  <option value="balanced">Balanced</option>
                  <option value="scale-wins">Scale wins</option>
                  <option value="defend-margin">Defend margin</option>
                  <option value="sniper">Sniper</option>
                </select>
              </div>
            </div>
            <div class="button-row">
              <button id="run-ai-button">Run BidStrategyAI</button>
              <button class="secondary" id="copy-ai-from-best-button">Use best live auction</button>
            </div>
            <div class="result-banner" id="ai-result">
              BidStrategyAI is waiting for an optimization request.
            </div>
            <div class="stack" id="ai-cards" style="margin-top: 16px;"></div>
          </article>
        </section>

        <section class="triple-grid">
          <article class="card panel">
            <div class="panel-header">
              <div>
                <h3>Sniper windows</h3>
                <p>Prioritized live auctions ranked by confidence and urgency.</p>
              </div>
            </div>
            <div class="stack" id="sniper-opportunities"></div>
          </article>

          <article class="card panel">
            <div class="panel-header">
              <div>
                <h3>Strategy cards</h3>
                <p>Auto-generated recommendations for the live field.</p>
              </div>
            </div>
            <div class="stack" id="strategy-cards"></div>
          </article>

          <article class="card panel">
            <div class="panel-header">
              <div>
                <h3>Replay stream</h3>
                <p>Recent bids, spreads, and quality signals from the current bid war.</p>
              </div>
            </div>
            <div class="event-stream" id="replay-stream"></div>
          </article>
        </section>

        <section class="card panel">
          <div class="panel-header">
            <div>
              <h2>Live auction ledger</h2>
              <p>Current snapshot of every live auction where the advertiser is on the leaderboard.</p>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Auction</th>
                  <th>Campaign</th>
                  <th>Winner</th>
                  <th>Second price</th>
                  <th>Avg attention</th>
                  <th>Avg fraud</th>
                  <th>Accepted bids</th>
                </tr>
              </thead>
              <tbody id="auction-table"></tbody>
            </table>
          </div>
        </section>

        <section class="card panel">
          <div class="panel-header">
            <div>
              <h2>Operator notes</h2>
              <p class="footer-note">
                Quantads only monetizes on verified outcomes. This war room therefore optimizes toward probability-weighted outcome value,
                not vanity impression share. Use sniper mode sparingly, trust the fraud pulse over raw win rate, and verify any high-aggression
                recommendation against the margin spread before deploying to auto-apply systems.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>

    <script>
      const advertiserId = ${JSON.stringify(safeAdvertiserId)};
      const authToken = decodeURIComponent(${JSON.stringify(safeToken)});
      const state = {
        snapshot: null,
        socket: null,
        lastSnapshotAt: null,
        latestStrategyResult: null,
        latestSniperResult: null
      };

      const summaryGrid = document.getElementById("summary-grid");
      const connectionPill = document.getElementById("connection-pill");
      const refreshPill = document.getElementById("refresh-pill");
      const sniperPill = document.getElementById("sniper-pill");
      const riskPill = document.getElementById("risk-pill");
      const candlestickCanvas = document.getElementById("candlestick-canvas");
      const competitorCanvas = document.getElementById("competitor-canvas");
      const competitorTable = document.getElementById("competitor-table");
      const strategyCards = document.getElementById("strategy-cards");
      const sniperOpportunities = document.getElementById("sniper-opportunities");
      const replayStream = document.getElementById("replay-stream");
      const auctionTable = document.getElementById("auction-table");
      const sniperResult = document.getElementById("sniper-result");
      const aiResult = document.getElementById("ai-result");
      const aiCards = document.getElementById("ai-cards");
      const sniperAuctionSelect = document.getElementById("sniper-auction");
      const headerBestWindow = document.getElementById("header-best-window");
      const headerStrike = document.getElementById("header-strike");
      const headerRegression = document.getElementById("header-regression");
      const headerAiConfidence = document.getElementById("header-ai-confidence");

      const pulsePressureFill = document.getElementById("pulse-pressure-fill");
      const pulseVolatilityFill = document.getElementById("pulse-volatility-fill");
      const pulseSniperFill = document.getElementById("pulse-sniper-fill");
      const pulseMarginFill = document.getElementById("pulse-margin-fill");
      const pulsePressureText = document.getElementById("pulse-pressure-text");
      const pulseVolatilityText = document.getElementById("pulse-volatility-text");
      const pulseSniperText = document.getElementById("pulse-sniper-text");
      const pulseMarginText = document.getElementById("pulse-margin-text");

      const chartCandlesCount = document.getElementById("chart-candles-count");
      const chartBidRange = document.getElementById("chart-bid-range");
      const chartVolatility = document.getElementById("chart-volatility");
      const chartPressure = document.getElementById("chart-pressure");

      const formatCurrency = (value) => "$" + Number(value || 0).toFixed(2);
      const formatMetric = (value, digits = 2) => Number(value || 0).toFixed(digits);
      const formatPercent = (value) => Number((value || 0) * 100).toFixed(1) + "%";
      const formatTime = (value) => {
        if (!value) return "n/a";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      };

      const setGauge = (fill, textNode, value, maxValue, formatter, className) => {
        const pct = Math.max(0, Math.min(1, maxValue > 0 ? value / maxValue : 0));
        fill.style.width = (pct * 100).toFixed(1) + "%";
        if (className) {
          fill.className = "gauge-fill " + className;
        }
        textNode.textContent = formatter(value);
      };

      const createMetricCard = (label, value, sub) => {
        const article = document.createElement("article");
        article.className = "card metric-card";

        const labelNode = document.createElement("div");
        labelNode.className = "label";
        labelNode.textContent = label;

        const valueNode = document.createElement("div");
        valueNode.className = "value";
        valueNode.textContent = value;

        const subNode = document.createElement("div");
        subNode.className = "sub";
        subNode.textContent = sub;

        article.appendChild(labelNode);
        article.appendChild(valueNode);
        article.appendChild(subNode);
        return article;
      };

      const createEmptyState = (message) => {
        const div = document.createElement("div");
        div.className = "empty-state";
        div.textContent = message;
        return div;
      };

      const renderSummary = (snapshot) => {
        summaryGrid.replaceChildren();
        const cards = [
          ["Accepted bids", snapshot.summary.acceptedBids, formatPercent(snapshot.summary.acceptedBids / Math.max(snapshot.summary.totalRequests, 1)) + " of total requests"],
          ["Wins", snapshot.summary.wins, formatPercent(snapshot.summary.winRate) + " win rate"],
          ["Spend", formatCurrency(snapshot.summary.totalSpend), formatCurrency(snapshot.summary.totalClearingSpend) + " clearing spend"],
          ["Avg attention", formatMetric(snapshot.summary.averageAttentionScore, 3), "measured across live bid war traffic"],
          ["Avg fraud", formatMetric(snapshot.summary.averageFraudScore, 3), formatPercent(snapshot.summary.suspiciousTrafficRate) + " suspicious traffic"],
          ["Estimated ROAS", formatMetric(snapshot.summary.estimatedRoas, 2) + "x", formatMetric(snapshot.summary.estimatedOutcomes, 1) + " projected outcomes"],
          ["Pressure", formatMetric(snapshot.pulse.averagePressureIndex, 2), "live candle pressure index"],
          ["Margin spread", formatCurrency(snapshot.pulse.averageMarginSpread), "outcome value minus bid proxy"]
        ];
        cards.forEach((entry) => {
          summaryGrid.appendChild(createMetricCard(entry[0], String(entry[1]), entry[2]));
        });
      };

      const setupHeader = (snapshot) => {
        const best = snapshot.sniperMode.bestOpportunity;
        headerBestWindow.textContent = best ? best.auctionId + " · " + best.state.toUpperCase() : "No active window";
        headerStrike.textContent = best ? formatCurrency(best.recommendedSnipeBid) : "$0.00";
        headerRegression.textContent = String(snapshot.competitorIntelligence.length) + " profiles";
        headerAiConfidence.textContent = snapshot.strategyAI.length ? formatPercent(snapshot.strategyAI[0].confidence) : "0%";
      };

      const renderPulse = (snapshot) => {
        setGauge(pulsePressureFill, pulsePressureText, snapshot.pulse.averagePressureIndex, 2, (value) => formatMetric(value, 2), "");
        setGauge(pulseVolatilityFill, pulseVolatilityText, snapshot.pulse.averageVolatility, Math.max(snapshot.pulse.averageVolatility, 1), (value) => formatMetric(value, 2), "warning");
        setGauge(pulseSniperFill, pulseSniperText, snapshot.pulse.sniperReadinessRate, 1, (value) => formatPercent(value), "");
        setGauge(pulseMarginFill, pulseMarginText, Math.max(snapshot.pulse.averageMarginSpread, 0), Math.max(Math.abs(snapshot.pulse.averageMarginSpread), 1), (value) => formatCurrency(value), snapshot.pulse.averageMarginSpread >= 0 ? "" : "danger");
        riskPill.textContent = "Risk pulse · " + formatPercent(snapshot.summary.suspiciousTrafficRate) + " suspicious";
        riskPill.className = "pill " + (snapshot.summary.suspiciousTrafficRate >= 0.35 ? "danger" : snapshot.summary.suspiciousTrafficRate >= 0.18 ? "warning" : "success");
      };

      const sizeCanvas = (canvas) => {
        const ratio = window.devicePixelRatio || 1;
        const bounds = canvas.getBoundingClientRect();
        if (!bounds.width || !bounds.height) {
          return null;
        }
        const targetWidth = Math.floor(bounds.width * ratio);
        const targetHeight = Math.floor(bounds.height * ratio);
        if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
          canvas.width = targetWidth;
          canvas.height = targetHeight;
        }
        const ctx = canvas.getContext("2d");
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        return { ctx, width: bounds.width, height: bounds.height };
      };

      const drawGrid = (ctx, width, height, padding, rows, columns) => {
        ctx.save();
        ctx.strokeStyle = "rgba(122, 171, 255, 0.12)";
        ctx.lineWidth = 1;
        for (let row = 0; row <= rows; row += 1) {
          const y = padding.top + ((height - padding.top - padding.bottom) / rows) * row;
          ctx.beginPath();
          ctx.moveTo(padding.left, y);
          ctx.lineTo(width - padding.right, y);
          ctx.stroke();
        }
        for (let column = 0; column <= columns; column += 1) {
          const x = padding.left + ((width - padding.left - padding.right) / columns) * column;
          ctx.beginPath();
          ctx.moveTo(x, padding.top);
          ctx.lineTo(x, height - padding.bottom);
          ctx.stroke();
        }
        ctx.restore();
      };

      const drawCandlestickChart = () => {
        const sized = sizeCanvas(candlestickCanvas);
        if (!sized) return;
        const ctx = sized.ctx;
        const width = sized.width;
        const height = sized.height;
        const candles = (state.snapshot && state.snapshot.candles) || [];

        ctx.clearRect(0, 0, width, height);
        drawGrid(ctx, width, height, { top: 26, right: 24, bottom: 34, left: 56 }, 6, Math.max(candles.length - 1, 1));

        if (!candles.length) {
          ctx.fillStyle = "rgba(157, 179, 213, 0.9)";
          ctx.font = "16px Inter, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("No bid war candles available yet", width / 2, height / 2);
          return;
        }

        const prices = candles.flatMap((candle) => [candle.high, candle.low, candle.averageClearingPrice]);
        const maxPrice = Math.max.apply(null, prices) * 1.06;
        const minPrice = Math.min.apply(null, prices) * 0.94;
        const priceSpan = Math.max(maxPrice - minPrice, 0.1);
        const padding = { top: 26, right: 24, bottom: 34, left: 56 };
        const plotWidth = width - padding.left - padding.right;
        const plotHeight = height - padding.top - padding.bottom;
        const stepX = candles.length > 1 ? plotWidth / (candles.length - 1) : plotWidth;
        const candleWidth = Math.max(Math.min(stepX * 0.46, 24), 10);
        const toX = (index) => padding.left + stepX * index;
        const toY = (price) => padding.top + (1 - (price - minPrice) / priceSpan) * plotHeight;

        ctx.save();
        ctx.strokeStyle = "rgba(142, 242, 169, 0.95)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        candles.forEach((candle, index) => {
          const x = toX(index);
          const y = toY(candle.averageClearingPrice);
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.restore();

        const best = state.snapshot.sniperMode.bestOpportunity;
        if (best) {
          ctx.save();
          ctx.strokeStyle = "rgba(255, 123, 123, 0.85)";
          ctx.setLineDash([6, 6]);
          const sniperY = toY(best.priceToBeat);
          ctx.beginPath();
          ctx.moveTo(padding.left, sniperY);
          ctx.lineTo(width - padding.right, sniperY);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = "rgba(255, 123, 123, 0.95)";
          ctx.font = "12px Inter, sans-serif";
          ctx.fillText("Sniper trigger " + formatCurrency(best.priceToBeat), padding.left + 8, sniperY - 8);
          ctx.restore();
        }

        candles.forEach((candle, index) => {
          const x = toX(index);
          const openY = toY(candle.open);
          const closeY = toY(candle.close);
          const highY = toY(candle.high);
          const lowY = toY(candle.low);
          const bullish = candle.close >= candle.open;

          ctx.save();
          ctx.strokeStyle = bullish ? "rgba(142, 242, 169, 0.95)" : "rgba(255, 123, 123, 0.95)";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x, highY);
          ctx.lineTo(x, lowY);
          ctx.stroke();

          ctx.fillStyle = bullish ? "rgba(142, 242, 169, 0.75)" : "rgba(255, 123, 123, 0.75)";
          const bodyY = Math.min(openY, closeY);
          const bodyHeight = Math.max(Math.abs(closeY - openY), 2);
          ctx.fillRect(x - candleWidth / 2, bodyY, candleWidth, bodyHeight);

          const pressureHeight = candle.pressureIndex / 2 * 48;
          ctx.fillStyle = "rgba(255, 189, 89, 0.45)";
          ctx.fillRect(x - candleWidth / 2, height - padding.bottom - pressureHeight, candleWidth, pressureHeight);
          ctx.restore();
        });

        ctx.save();
        ctx.fillStyle = "rgba(157, 179, 213, 0.92)";
        ctx.font = "12px Inter, sans-serif";
        ctx.textAlign = "right";
        for (let i = 0; i <= 5; i += 1) {
          const price = minPrice + (priceSpan / 5) * i;
          ctx.fillText(formatCurrency(maxPrice - (priceSpan / 5) * i), padding.left - 8, padding.top + (plotHeight / 5) * i + 4);
        }
        ctx.textAlign = "center";
        candles.forEach((candle, index) => {
          if (candles.length > 12 && index % Math.ceil(candles.length / 10) !== 0 && index !== candles.length - 1) return;
          ctx.fillText(formatTime(candle.bucketStart), toX(index), height - 10);
        });
        ctx.restore();

        chartCandlesCount.textContent = String(candles.length);
        chartBidRange.textContent = formatCurrency(minPrice) + " → " + formatCurrency(maxPrice);
        chartVolatility.textContent = formatMetric(candles.reduce((total, candle) => total + candle.volatility, 0) / Math.max(candles.length, 1), 2);
        chartPressure.textContent = formatMetric(candles.reduce((total, candle) => total + candle.pressureIndex, 0) / Math.max(candles.length, 1), 2);
      };

      const drawCompetitorChart = () => {
        const sized = sizeCanvas(competitorCanvas);
        if (!sized) return;
        const ctx = sized.ctx;
        const width = sized.width;
        const height = sized.height;
        const competitors = (state.snapshot && state.snapshot.competitorIntelligence) || [];

        ctx.clearRect(0, 0, width, height);
        drawGrid(ctx, width, height, { top: 18, right: 22, bottom: 30, left: 52 }, 5, Math.max(competitors.length - 1, 1));

        if (!competitors.length) {
          ctx.fillStyle = "rgba(157, 179, 213, 0.9)";
          ctx.font = "16px Inter, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("No competitor regression profiles available yet", width / 2, height / 2);
          return;
        }

        const maxBid = Math.max.apply(null, competitors.map((entry) => entry.predictedNextBid)) * 1.12;
        const maxAggression = Math.max.apply(null, competitors.map((entry) => entry.aggressiveness)) || 1;
        const padding = { top: 18, right: 22, bottom: 30, left: 52 };
        const plotWidth = width - padding.left - padding.right;
        const plotHeight = height - padding.top - padding.bottom;
        const stepX = competitors.length > 1 ? plotWidth / (competitors.length - 1) : plotWidth;
        const toX = (index) => padding.left + index * stepX;
        const toY = (value) => padding.top + (1 - value / Math.max(maxBid, 1)) * plotHeight;

        ctx.save();
        ctx.strokeStyle = "rgba(141, 124, 255, 0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        competitors.forEach((entry, index) => {
          const x = toX(index);
          const y = toY(entry.predictedNextBid);
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.restore();

        competitors.forEach((entry, index) => {
          const x = toX(index);
          const predictedY = toY(entry.predictedNextBid);
          const aggressionHeight = entry.aggressiveness / Math.max(maxAggression, 1) * 70;

          ctx.save();
          ctx.fillStyle = "rgba(81, 211, 255, 0.75)";
          ctx.fillRect(x - 12, height - padding.bottom - aggressionHeight, 24, aggressionHeight);

          ctx.beginPath();
          ctx.fillStyle = "rgba(141, 124, 255, 0.95)";
          ctx.arc(x, predictedY, 6 + entry.confidence * 4, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = "rgba(255, 189, 89, 0.9)";
          ctx.font = "12px Inter, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(entry.competitorHandle, x, height - 10);
          ctx.restore();
        });
      };

      const createInfoCard = (title, body, metrics, stateClass) => {
        const article = document.createElement("article");
        article.className = "info-card";

        const titleRow = document.createElement("div");
        titleRow.style.display = "flex";
        titleRow.style.justifyContent = "space-between";
        titleRow.style.alignItems = "center";
        titleRow.style.gap = "12px";

        const heading = document.createElement("h4");
        heading.textContent = title;

        titleRow.appendChild(heading);
        if (stateClass) {
          const chip = document.createElement("span");
          chip.className = "chip " + stateClass;
          chip.textContent = stateClass;
          titleRow.appendChild(chip);
        }

        const bodyNode = document.createElement("p");
        bodyNode.textContent = body;

        const metricsGrid = document.createElement("div");
        metricsGrid.className = "mini-metrics";
        metrics.forEach((metric) => {
          const wrapper = document.createElement("div");
          wrapper.className = "mini-metric";
          const strong = document.createElement("strong");
          strong.textContent = metric.label;
          const span = document.createElement("span");
          span.textContent = metric.value;
          wrapper.appendChild(strong);
          wrapper.appendChild(span);
          metricsGrid.appendChild(wrapper);
        });

        article.appendChild(titleRow);
        article.appendChild(bodyNode);
        article.appendChild(metricsGrid);
        return article;
      };

      const renderSniperOpportunities = (snapshot) => {
        sniperOpportunities.replaceChildren();
        sniperAuctionSelect.replaceChildren();
        const defaultOption = document.createElement("option");
        defaultOption.value = "";
        defaultOption.textContent = "Best available window";
        sniperAuctionSelect.appendChild(defaultOption);

        if (!snapshot.sniperMode.opportunities.length) {
          sniperOpportunities.appendChild(createEmptyState("No live sniper windows yet. Submit more exchange bids to activate the console."));
          return;
        }

        snapshot.sniperMode.opportunities.forEach((opportunity, index) => {
          const option = document.createElement("option");
          option.value = opportunity.auctionId;
          option.textContent = opportunity.auctionId + " · " + opportunity.state.toUpperCase();
          sniperAuctionSelect.appendChild(option);
          if (index === 0) {
            sniperAuctionSelect.value = opportunity.auctionId;
          }

          sniperOpportunities.appendChild(
            createInfoCard(
              opportunity.auctionId,
              "Campaign " + opportunity.campaignId + " can strike at " + formatCurrency(opportunity.recommendedSnipeBid) + " with " + formatPercent(opportunity.confidence) + " confidence.",
              [
                { label: "Delta to win", value: formatCurrency(opportunity.deltaToWin) },
                { label: "Trigger", value: formatCurrency(opportunity.priceToBeat) },
                { label: "Expected clear", value: formatCurrency(opportunity.expectedClearingPrice) },
                { label: "Urgency", value: formatPercent(opportunity.urgency) }
              ],
              opportunity.state
            )
          );
        });

        const best = snapshot.sniperMode.bestOpportunity;
        sniperPill.textContent = best ? "Sniper mode · " + best.state.toUpperCase() + " on " + best.auctionId : "Sniper mode idle";
        sniperPill.className = "pill " + (best ? (best.state === "ready" ? "success" : best.state === "watch" ? "warning" : "danger") : "");
      };

      const renderStrategyCards = (snapshot) => {
        strategyCards.replaceChildren();
        aiCards.replaceChildren();

        if (!snapshot.strategyAI.length) {
          strategyCards.appendChild(createEmptyState("BidStrategyAI needs at least one live auction before it can generate strategy cards."));
          return;
        }

        snapshot.strategyAI.forEach((card) => {
          const info = createInfoCard(
            card.auctionId,
            card.reasoning[0] || "BidStrategyAI created a recommendation for the live field.",
            [
              { label: "Current bid", value: formatCurrency(card.currentBid) },
              { label: "Recommended", value: formatCurrency(card.recommendedBid) },
              { label: "Confidence", value: formatPercent(card.confidence) },
              { label: "Aggression", value: formatPercent(card.aggressionIndex) }
            ],
            card.sniperReady ? "ready" : "watch"
          );
          strategyCards.appendChild(info);

          const detail = createInfoCard(
            card.auctionId + " · " + card.objective,
            (card.reasoning || []).slice(0, 3).join(" "),
            [
              { label: "Efficiency", value: formatPercent(card.efficiencyIndex) },
              { label: "Floor", value: formatCurrency(card.guardrails.floorPrice) },
              { label: "Max", value: formatCurrency(card.guardrails.maxPrice) },
              { label: "Max increment", value: formatCurrency(card.guardrails.maxIncrement) }
            ],
            card.sniperReady ? "ready" : "watch"
          );
          aiCards.appendChild(detail);
        });
      };

      const renderCompetitorTable = (snapshot) => {
        competitorTable.replaceChildren();
        if (!snapshot.competitorIntelligence.length) {
          const row = document.createElement("tr");
          const cell = document.createElement("td");
          cell.colSpan = 6;
          cell.textContent = "No regression profiles yet.";
          row.appendChild(cell);
          competitorTable.appendChild(row);
          return;
        }

        snapshot.competitorIntelligence.forEach((entry) => {
          const row = document.createElement("tr");
          [
            entry.competitorHandle,
            entry.recentTrend,
            formatCurrency(entry.predictedNextBid),
            formatMetric(entry.rSquared, 3),
            formatMetric(entry.coefficients.marketPressure, 3),
            formatMetric(entry.coefficients.leaderGap, 3)
          ].forEach((value) => {
            const td = document.createElement("td");
            td.textContent = String(value);
            row.appendChild(td);
          });
          competitorTable.appendChild(row);
        });
      };

      const renderReplay = (snapshot) => {
        replayStream.replaceChildren();
        if (!snapshot.replay.length) {
          replayStream.appendChild(createEmptyState("Replay stream is empty until bid responses flow through the exchange."));
          return;
        }

        snapshot.replay.forEach((event) => {
          const item = document.createElement("article");
          item.className = "event-item";

          const header = document.createElement("header");
          const strong = document.createElement("strong");
          strong.textContent = event.auctionId + " · " + formatCurrency(event.rankedBid);
          const small = document.createElement("span");
          small.className = "chip " + (event.wonAuction ? "ready" : event.rejected ? "hold" : "watch");
          small.textContent = event.settlementStatus;
          header.appendChild(strong);
          header.appendChild(small);

          const text = document.createElement("p");
          text.textContent =
            "Clearing " +
            formatCurrency(event.clearingPrice || 0) +
            ", trigger " +
            formatCurrency(event.priceToBeat) +
            ", attention " +
            formatPercent(event.attentionScore) +
            ", fraud " +
            formatMetric(event.fraudScore, 3) +
            ", LTV proxy " +
            formatCurrency(event.verifiedLtv) +
            ".";

          const tags = document.createElement("div");
          tags.className = "event-tags";
          [
            "Campaign " + event.campaignId,
            "Pressure " + formatMetric(event.marketPressure, 2),
            "Sniper score " + formatPercent(event.sniperWindowScore),
            "Margin " + formatCurrency(event.marginSpread),
            formatTime(event.occurredAt)
          ].forEach((value) => {
            const tag = document.createElement("span");
            tag.className = "tag";
            tag.textContent = value;
            tags.appendChild(tag);
          });

          item.appendChild(header);
          item.appendChild(text);
          item.appendChild(tags);
          replayStream.appendChild(item);
        });
      };

      const renderAuctionTable = (snapshot) => {
        auctionTable.replaceChildren();
        if (!snapshot.liveAuctions.length) {
          const row = document.createElement("tr");
          const cell = document.createElement("td");
          cell.colSpan = 7;
          cell.textContent = "No live auctions tracked yet.";
          row.appendChild(cell);
          auctionTable.appendChild(row);
          return;
        }

        snapshot.liveAuctions.forEach((auction) => {
          const row = document.createElement("tr");
          const winner = auction.winner ? auction.winner.advertiserId + " · " + formatCurrency(auction.winner.finalBid) : "n/a";
          [
            auction.auctionId,
            auction.campaignId,
            winner,
            formatCurrency(auction.secondPrice || 0),
            formatMetric(auction.averageAttentionMultiplier, 3),
            formatMetric(auction.averageFraudScore, 3),
            String(auction.acceptedBids)
          ].forEach((value) => {
            const td = document.createElement("td");
            td.textContent = String(value);
            row.appendChild(td);
          });
          auctionTable.appendChild(row);
        });
      };

      const renderSnapshot = (snapshot) => {
        state.snapshot = snapshot;
        state.lastSnapshotAt = new Date();
        renderSummary(snapshot);
        setupHeader(snapshot);
        renderPulse(snapshot);
        renderSniperOpportunities(snapshot);
        renderStrategyCards(snapshot);
        renderCompetitorTable(snapshot);
        renderReplay(snapshot);
        renderAuctionTable(snapshot);
        drawCandlestickChart();
        drawCompetitorChart();

        const best = snapshot.sniperMode.bestOpportunity;
        if (best) {
          sniperResult.textContent =
            "Best live window: " +
            best.auctionId +
            " · target " +
            formatCurrency(best.recommendedSnipeBid) +
            " · confidence " +
            formatPercent(best.confidence) +
            " · urgency " +
            formatPercent(best.urgency) +
            ".";
        }

        refreshPill.textContent = "Last refresh " + formatTime(snapshot.generatedAt);
        refreshPill.className = "pill success";
      };

      const fetchSnapshot = async () => {
        const response = await fetch(
          "/api/v1/bid-war/advertisers/" + encodeURIComponent(advertiserId) + "?granularity=minute&candleLimit=60&replayLimit=80",
          {
            headers: {
              authorization: "Bearer " + authToken
            }
          }
        );
        if (!response.ok) {
          throw new Error("Snapshot request failed with status " + response.status);
        }
        const body = await response.json();
        renderSnapshot(body);
      };

      const readNumeric = (id, fallback) => {
        const element = document.getElementById(id);
        const value = Number(element.value);
        return Number.isFinite(value) ? value : fallback;
      };

      const readText = (id, fallback) => {
        const element = document.getElementById(id);
        return element.value || fallback;
      };

      const buildSniperPayload = () => {
        const selectedAuction = readText("sniper-auction", "");
        return {
          auctionId: selectedAuction || undefined,
          baseOutcomePrice: readNumeric("sniper-base-price", 10),
          audience: {
            verifiedLtv: readNumeric("sniper-verified-ltv", 80),
            intentScore: readNumeric("sniper-intent", 0.7),
            conversionRate: readNumeric("sniper-conversion", 0.25),
            attentionScore: readNumeric("sniper-attention", 0.82),
            recencyMultiplier: 1.05
          },
          marketPressure: readNumeric("sniper-market-pressure", 1.08),
          floorPrice: Math.max(readNumeric("sniper-base-price", 10) * 0.8, 0.01),
          maxPrice: readNumeric("sniper-max-price", 24),
          riskTolerance: readNumeric("sniper-risk", 0.3),
          maxIncrement: readNumeric("sniper-max-increment", 2.5),
          aggression: readNumeric("sniper-aggression", 0.58),
          objective: "sniper"
        };
      };

      const buildAiPayload = () => {
        return {
          baseOutcomePrice: readNumeric("ai-base-price", 12),
          audience: {
            verifiedLtv: readNumeric("ai-verified-ltv", 92),
            intentScore: readNumeric("ai-intent", 0.74),
            conversionRate: readNumeric("ai-conversion", 0.29),
            attentionScore: readNumeric("ai-attention", 0.84),
            recencyMultiplier: 1.05
          },
          marketPressure: readNumeric("ai-market-pressure", 1.11),
          floorPrice: Math.max(readNumeric("ai-base-price", 12) * 0.8, 0.01),
          maxPrice: readNumeric("ai-base-price", 12) * 2.6,
          riskTolerance: readNumeric("ai-risk", 0.28),
          objective: readText("ai-objective", "balanced"),
          competitionIndex: readNumeric("ai-competition-index", 0.75),
          sniperMode: readText("ai-objective", "balanced") === "sniper",
          marginGuardrail: readNumeric("ai-margin-guardrail", 0.24)
        };
      };

      const postJson = async (url, body) => {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            authorization: "Bearer " + authToken,
            "content-type": "application/json"
          },
          body: JSON.stringify(body)
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(text || "Request failed with status " + response.status);
        }
        return response.json();
      };

      const runSniperMode = async () => {
        sniperResult.textContent = "Running sniper mode…";
        const body = buildSniperPayload();
        const response = await postJson("/api/v1/bid-war/advertisers/" + encodeURIComponent(advertiserId) + "/sniper-mode", body);
        state.latestSniperResult = response;
        if (!response.opportunity) {
          sniperResult.textContent = "Sniper mode found no valid live opportunity.";
          return;
        }
        sniperResult.textContent =
          "Sniper mode recommends " +
          formatCurrency(response.opportunity.recommendedSnipeBid) +
          " on " +
          response.opportunity.auctionId +
          " with " +
          formatPercent(response.opportunity.confidence) +
          " confidence and " +
          formatPercent(response.opportunity.urgency) +
          " urgency.";
      };

      const runBidStrategyAi = async () => {
        aiResult.textContent = "Running BidStrategyAI…";
        const body = buildAiPayload();
        const response = await postJson("/api/v1/bid-war/advertisers/" + encodeURIComponent(advertiserId) + "/strategy/optimize", body);
        state.latestStrategyResult = response;
        aiResult.textContent =
          "BidStrategyAI recommends " +
          formatCurrency(response.recommendedBid) +
          " from a baseline of " +
          formatCurrency(response.baselineBid) +
          " with " +
          formatPercent(response.confidence) +
          " confidence.";
      };

      const syncPresetFields = () => {
        if (!state.snapshot) return;
        const preset = state.snapshot.sniperMode.defaultPreset;
        document.getElementById("sniper-base-price").value = String(Number(preset.baseOutcomePrice || 1).toFixed(2));
        document.getElementById("sniper-verified-ltv").value = String(Number((preset.audience && preset.audience.verifiedLtv) || 10).toFixed(2));
        document.getElementById("sniper-intent").value = String(Number((preset.audience && preset.audience.intentScore) || 0.5).toFixed(2));
        document.getElementById("sniper-conversion").value = String(Number((preset.audience && preset.audience.conversionRate) || 0.2).toFixed(2));
        document.getElementById("sniper-attention").value = String(Number((preset.audience && preset.audience.attentionScore) || 0.7).toFixed(2));
        document.getElementById("sniper-market-pressure").value = String(Number(preset.marketPressure || 1).toFixed(2));
        document.getElementById("sniper-risk").value = String(Number(preset.riskTolerance || 0.3).toFixed(2));
        document.getElementById("sniper-max-price").value = String(Number(preset.maxPrice || preset.baseOutcomePrice * 2.4 || 10).toFixed(2));
        document.getElementById("sniper-max-increment").value = String(Number(preset.maxIncrement || 1.5).toFixed(2));
        document.getElementById("sniper-aggression").value = String(Number(preset.aggression || 0.55).toFixed(2));
        document.getElementById("sniper-aggression-label").textContent = Math.round(Number(preset.aggression || 0.55) * 100) + "%";
      };

      const copyAiFromBestAuction = () => {
        if (!state.snapshot || !state.snapshot.strategyAI.length) return;
        const best = state.snapshot.strategyAI[0];
        document.getElementById("ai-base-price").value = String(Number(best.currentBid || 1).toFixed(2));
        document.getElementById("ai-verified-ltv").value = String(Number((best.currentBid || 1) * 8).toFixed(2));
        document.getElementById("ai-attention").value = String(Math.min(0.99, 0.65 + best.confidence * 0.25).toFixed(2));
        document.getElementById("ai-competition-index").value = String(Number(best.aggressionIndex || 0.7).toFixed(2));
        document.getElementById("ai-objective").value = best.objective;
      };

      const connectSocket = () => {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const socketUrl =
          protocol +
          "//" +
          window.location.host +
          "/ws/analytics?advertiserId=" +
          encodeURIComponent(advertiserId) +
          "&token=" +
          encodeURIComponent(authToken);

        const socket = new WebSocket(socketUrl);
        state.socket = socket;
        connectionPill.textContent = "Connecting to exchange stream";
        connectionPill.className = "pill warning";

        socket.addEventListener("open", () => {
          connectionPill.textContent = "Live stream connected";
          connectionPill.className = "pill success";
        });

        socket.addEventListener("message", (event) => {
          try {
            const payload = JSON.parse(event.data);
            if (payload.type === "hello" || payload.type === "event" || payload.type === "snapshot") {
              fetchSnapshot().catch((error) => {
                refreshPill.textContent = error instanceof Error ? error.message : "Refresh failed";
                refreshPill.className = "pill danger";
              });
            }
          } catch (_error) {
            refreshPill.textContent = "WebSocket message parse error";
            refreshPill.className = "pill danger";
          }
        });

        socket.addEventListener("close", () => {
          connectionPill.textContent = "Stream disconnected · retrying";
          connectionPill.className = "pill warning";
          setTimeout(connectSocket, 2500);
        });

        socket.addEventListener("error", () => {
          connectionPill.textContent = "Stream error · using polling";
          connectionPill.className = "pill danger";
        });
      };

      document.getElementById("run-sniper-button").addEventListener("click", () => {
        runSniperMode().catch((error) => {
          sniperResult.textContent = error instanceof Error ? error.message : "Sniper mode failed";
        });
      });

      document.getElementById("load-best-window-button").addEventListener("click", () => {
        syncPresetFields();
      });

      document.getElementById("run-ai-button").addEventListener("click", () => {
        runBidStrategyAi().catch((error) => {
          aiResult.textContent = error instanceof Error ? error.message : "BidStrategyAI failed";
        });
      });

      document.getElementById("copy-ai-from-best-button").addEventListener("click", () => {
        copyAiFromBestAuction();
      });

      document.getElementById("sniper-aggression").addEventListener("input", (event) => {
        const value = Number(event.target.value || 0);
        document.getElementById("sniper-aggression-label").textContent = Math.round(value * 100) + "%";
      });

      window.addEventListener("resize", () => {
        drawCandlestickChart();
        drawCompetitorChart();
      });

      const bootstrap = async () => {
        try {
          await fetchSnapshot();
          syncPresetFields();
          copyAiFromBestAuction();
          connectSocket();
          setInterval(() => {
            fetchSnapshot().catch(() => {});
          }, 12000);
        } catch (error) {
          refreshPill.textContent = error instanceof Error ? error.message : "Initial load failed";
          refreshPill.className = "pill danger";
        }
      };

      bootstrap();
    </script>
  </body>
</html>`;
};
