interface YieldDashboardSnapshot {
  summary: {
    totalAuctions: number;
    executedAuctions: number;
    holdRate: number;
    averageYieldSpread: number;
    timeoutRate: number;
    averageMarketHeat: number;
  };
  bidderLeaderboard: Array<{
    bidderId: string;
    wins: number;
    averageYieldSpread: number;
    averageLatencyMs: number;
  }>;
  formatMix: Array<{
    creativeStyle: string;
    wins: number;
    averageYieldScore: number;
  }>;
  recentAuctions: Array<{
    evaluationId: string;
    auctionId: string;
    slotId: string;
    platform: string;
    decision: string;
    bidderId: string | null;
    creativeStyle: string | null;
    yieldSpread: number;
    generatedAt: string;
  }>;
}

interface YieldDashOptions {
  dashboard: YieldDashboardSnapshot;
  hasAuthorizationHeader: boolean;
}

const safeScriptJson = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");

export const getYieldDashHtml = ({ dashboard, hasAuthorizationHeader }: YieldDashOptions): string => {

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Quantads Yield Dashboard</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #040916;
        --panel: rgba(11, 24, 44, 0.94);
        --panel-strong: rgba(16, 32, 60, 0.98);
        --border: rgba(109, 162, 255, 0.2);
        --text: #eef4ff;
        --muted: #91a8cf;
        --accent: #52d3ff;
        --accent-2: #9ef01a;
        --warn: #ffd166;
        --danger: #ff6b6b;
        --grid: rgba(146, 185, 255, 0.12);
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top right, rgba(82, 211, 255, 0.18), transparent 28%),
          radial-gradient(circle at bottom left, rgba(158, 240, 26, 0.15), transparent 26%),
          var(--bg);
        color: var(--text);
      }
      header, main { padding: 24px 28px; }
      header {
        position: sticky;
        top: 0;
        background: rgba(4, 9, 22, 0.82);
        backdrop-filter: blur(14px);
        border-bottom: 1px solid var(--border);
        z-index: 10;
      }
      h1, h2, h3, p { margin-top: 0; }
      .subtle { color: var(--muted); }
      .status-bar, .summary-grid, .chart-grid, .two-col, .stack { display: grid; gap: 18px; }
      .status-bar { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin-top: 16px; }
      .summary-grid { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
      .two-col { grid-template-columns: 1.2fr 0.8fr; }
      .panel {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 18px;
        box-shadow: 0 18px 40px rgba(0,0,0,0.2);
      }
      .panel.strong { background: var(--panel-strong); }
      .pill {
        border-radius: 999px;
        padding: 10px 14px;
        border: 1px solid rgba(82, 211, 255, 0.2);
        background: rgba(82, 211, 255, 0.1);
        font-size: 13px;
      }
      .metric-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; }
      .metric-value { font-size: 30px; font-weight: 700; margin: 8px 0 10px; }
      .chart {
        border-radius: 16px;
        border: 1px solid rgba(109, 162, 255, 0.14);
        padding: 12px;
        min-height: 240px;
      }
      svg { width: 100%; height: 240px; display: block; }
      .legend { display: flex; gap: 16px; flex-wrap: wrap; font-size: 13px; color: var(--muted); }
      .legend span::before {
        content: "";
        display: inline-block;
        width: 10px;
        height: 10px;
        border-radius: 999px;
        margin-right: 8px;
      }
      .legend .a::before { background: var(--accent); }
      .legend .b::before { background: var(--accent-2); }
      .legend .c::before { background: var(--warn); }
      table { width: 100%; border-collapse: collapse; }
      th, td {
        padding: 11px 8px;
        text-align: left;
        border-bottom: 1px solid rgba(109, 162, 255, 0.12);
        font-size: 14px;
      }
      th { color: var(--muted); }
      .list { display: grid; gap: 12px; }
      .card {
        border-radius: 14px;
        border: 1px solid rgba(109, 162, 255, 0.12);
        background: rgba(255,255,255,0.02);
        padding: 14px;
      }
      .tag {
        display: inline-flex;
        align-items: center;
        padding: 4px 10px;
        border-radius: 999px;
        background: rgba(158, 240, 26, 0.14);
        color: var(--accent-2);
        font-size: 12px;
      }
      @media (max-width: 1000px) {
        .two-col { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <header>
      <h1>Quantads Yield Dashboard</h1>
      <p class="subtle">Algorithmic arbitrage view for outcome-based yield. The engine selects on expected spread, not raw CPM.</p>
      <p class="subtle">API source: <code>/api/v1/yield/dashboard</code></p>
      <div class="status-bar">
        <div class="pill" id="connection-pill">${hasAuthorizationHeader ? "Authenticated snapshot loaded" : "Snapshot loaded"}</div>
        <div class="pill" id="refresh-pill">Refresh the page for the latest arbitrage snapshot</div>
      </div>
    </header>
    <main class="stack">
      <section class="summary-grid" id="summary-grid"></section>
      <section class="panel strong">
        <h2>Yield Spread Curve</h2>
        <p class="subtle">Recent auction evaluations plotted by arbitrage spread, timeout pressure, and execution rate.</p>
        <div class="legend">
          <span class="a">Yield spread</span>
          <span class="b">Executed auction</span>
          <span class="c">Timeout pressure</span>
        </div>
        <div class="chart"><svg id="spread-chart" viewBox="0 0 900 240" preserveAspectRatio="none"></svg></div>
      </section>
      <section class="two-col">
        <div class="stack">
          <section class="panel">
            <h2>Recent Auctions</h2>
            <div class="list" id="recent-auctions"></div>
          </section>
        </div>
        <div class="stack">
          <section class="panel">
            <h2>Bidder Leaderboard</h2>
            <table>
              <thead>
                <tr>
                  <th>Bidder</th>
                  <th>Wins</th>
                  <th>Avg spread</th>
                  <th>Latency</th>
                </tr>
              </thead>
              <tbody id="leaderboard-body"></tbody>
            </table>
          </section>
          <section class="panel">
            <h2>Creative Mix</h2>
            <table>
              <thead>
                <tr>
                  <th>Style</th>
                  <th>Wins</th>
                  <th>Avg yield</th>
                </tr>
              </thead>
              <tbody id="format-body"></tbody>
            </table>
          </section>
        </div>
      </section>
    </main>
    <script>
      const snapshot = ${safeScriptJson(dashboard)};
      const summaryGrid = document.getElementById("summary-grid");
      const leaderboardBody = document.getElementById("leaderboard-body");
      const formatBody = document.getElementById("format-body");
      const recentAuctions = document.getElementById("recent-auctions");
      const spreadChart = document.getElementById("spread-chart");
      const connectionPill = document.getElementById("connection-pill");
      const refreshPill = document.getElementById("refresh-pill");

      const number = (value, digits = 2) => Number(value || 0).toFixed(digits);
      const currency = (value) => "$" + number(value, 2);
      const percent = (value) => number((value || 0) * 100, 1) + "%";

      const drawGrid = (svg, width, height) => {
        const ns = "http://www.w3.org/2000/svg";
        for (let index = 0; index <= 4; index += 1) {
          const line = document.createElementNS(ns, "line");
          const y = 20 + ((height - 40) * index) / 4;
          line.setAttribute("x1", "0");
          line.setAttribute("x2", String(width));
          line.setAttribute("y1", String(y));
          line.setAttribute("y2", String(y));
          line.setAttribute("stroke", "rgba(146, 185, 255, 0.12)");
          line.setAttribute("stroke-width", "1");
          svg.appendChild(line);
        }
      };

      const path = (points, color) => {
        const ns = "http://www.w3.org/2000/svg";
        const el = document.createElementNS(ns, "path");
        el.setAttribute("fill", "none");
        el.setAttribute("stroke", color);
        el.setAttribute("stroke-width", "3");
        el.setAttribute("stroke-linecap", "round");
        el.setAttribute("stroke-linejoin", "round");
        el.setAttribute("d", points.map((point, index) => (index ? "L" : "M") + point[0] + " " + point[1]).join(" "));
        return el;
      };

      const renderSummary = (summary) => {
        const cards = [
          ["Total auctions", summary.totalAuctions, "evaluated by arbitrage engine"],
          ["Executed", summary.executedAuctions, percent(summary.executedAuctions / Math.max(summary.totalAuctions, 1)) + " execution rate"],
          ["Avg spread", currency(summary.averageYieldSpread), "average positive spread captured"],
          ["Timeout rate", percent(summary.timeoutRate), "DSP responses over budget"],
          ["Hold rate", percent(summary.holdRate), "slots intentionally held"],
          ["Market heat", number(summary.averageMarketHeat, 2) + "x", "relative to floor CPM"]
        ];
        summaryGrid.innerHTML = cards.map((card) => '<article class="panel"><div class="metric-label">' + card[0] + '</div><div class="metric-value">' + card[1] + '</div><div class="subtle">' + card[2] + '</div></article>').join("");
      };

      const renderRecentAuctions = (auctions) => {
        recentAuctions.innerHTML = auctions.map((auction) => {
          const tag = auction.decision === "execute" ? '<span class="tag">execute</span>' : '<span class="tag" style="background: rgba(255, 107, 107, 0.15); color: #ff9aa2;">hold</span>';
          return '<article class="card"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center;"><strong>' + auction.auctionId + '</strong>' + tag + '</div><p class="subtle">Slot ' + auction.slotId + ' · ' + auction.platform + '</p><p class="subtle">Bidder: ' + (auction.bidderId || 'n/a') + ' · Style: ' + (auction.creativeStyle || 'n/a') + '</p><p>Yield spread ' + currency(auction.yieldSpread) + '</p></article>';
        }).join("");
      };

      const renderLeaderboard = (rows) => {
        leaderboardBody.innerHTML = rows.map((row) => '<tr><td>' + row.bidderId + '</td><td>' + row.wins + '</td><td>' + currency(row.averageYieldSpread) + '</td><td>' + number(row.averageLatencyMs, 2) + 'ms</td></tr>').join("");
      };

      const renderFormatMix = (rows) => {
        formatBody.innerHTML = rows.map((row) => '<tr><td>' + row.creativeStyle + '</td><td>' + row.wins + '</td><td>' + number(row.averageYieldScore, 2) + '</td></tr>').join("");
      };

      const drawChart = (auctions, summary) => {
        spreadChart.innerHTML = "";
        const width = 900;
        const height = 240;
        drawGrid(spreadChart, width, height);
        if (!auctions.length) {
          return;
        }
        const maxValue = Math.max(...auctions.map((row) => Math.abs(row.yieldSpread)), summary.timeoutRate * 20, 1);
        const toPoint = (index, value) => {
          const x = 24 + ((width - 48) * index) / Math.max(auctions.length - 1, 1);
          const y = height - 24 - ((height - 48) * value) / maxValue;
          return [x, y];
        };
        spreadChart.appendChild(path(auctions.map((row, index) => toPoint(index, Math.abs(row.yieldSpread))), "#52d3ff"));
        spreadChart.appendChild(path(auctions.map((row, index) => toPoint(index, row.decision === "execute" ? Math.abs(row.yieldSpread) : 0.2)), "#9ef01a"));
        spreadChart.appendChild(path(auctions.map((_, index) => toPoint(index, summary.timeoutRate * 20)), "#ffd166"));
      };

      const hydrate = (dashboardSnapshot) => {
        renderSummary(dashboardSnapshot.summary);
        renderRecentAuctions(dashboardSnapshot.recentAuctions || []);
        renderLeaderboard(dashboardSnapshot.bidderLeaderboard || []);
        renderFormatMix(dashboardSnapshot.formatMix || []);
        drawChart(dashboardSnapshot.recentAuctions || [], dashboardSnapshot.summary);
        refreshPill.textContent = "Last refresh " + new Date().toLocaleTimeString();
      };

      hydrate(snapshot);
      connectionPill.textContent = "Dashboard ready";
    </script>
  </body>
</html>`;
};
