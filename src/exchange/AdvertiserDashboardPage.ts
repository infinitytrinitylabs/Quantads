interface DashboardPageOptions {
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

export const getAdvertiserDashboardHtml = ({ advertiserId, token }: DashboardPageOptions): string => {
  const safeAdvertiserId = escapeHtml(advertiserId);
  const safeToken = encodeURIComponent(token);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Quantads Advertiser Exchange Dashboard</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #07111f;
        --surface: rgba(12, 24, 43, 0.92);
        --surface-strong: rgba(20, 39, 71, 0.96);
        --border: rgba(111, 176, 255, 0.22);
        --text: #e8f0ff;
        --muted: #95add3;
        --accent: #4cc9f0;
        --accent-2: #80ed99;
        --danger: #ff6b6b;
        --warning: #ffd166;
        --blocked: #ff8fa3;
        --grid: rgba(147, 196, 255, 0.12);
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top left, rgba(76, 201, 240, 0.18), transparent 35%),
          radial-gradient(circle at bottom right, rgba(128, 237, 153, 0.16), transparent 35%),
          var(--bg);
        color: var(--text);
      }
      header {
        padding: 28px 32px 16px;
        border-bottom: 1px solid var(--border);
        position: sticky;
        top: 0;
        backdrop-filter: blur(18px);
        background: rgba(7, 17, 31, 0.76);
        z-index: 10;
      }
      header h1 {
        margin: 0;
        font-size: 28px;
        letter-spacing: 0.02em;
      }
      header p {
        margin: 8px 0 0;
        color: var(--muted);
      }
      main {
        padding: 24px 32px 40px;
        display: grid;
        gap: 24px;
      }
      .status-bar {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
        align-items: center;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(76, 201, 240, 0.12);
        border: 1px solid rgba(76, 201, 240, 0.22);
        font-size: 13px;
        color: var(--text);
      }
      .grid {
        display: grid;
        gap: 18px;
      }
      .summary-grid {
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      }
      .panel {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 18px;
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.24);
      }
      .panel h2,
      .panel h3 {
        margin-top: 0;
      }
      .metric-value {
        font-size: 30px;
        font-weight: 700;
        letter-spacing: 0.01em;
      }
      .metric-label {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--muted);
        margin-bottom: 10px;
      }
      .metric-meta {
        color: var(--muted);
        font-size: 14px;
      }
      .chart-card {
        display: grid;
        gap: 14px;
      }
      .chart {
        width: 100%;
        min-height: 220px;
        border-radius: 16px;
        border: 1px solid rgba(111, 176, 255, 0.12);
        background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01));
        padding: 12px;
      }
      svg {
        width: 100%;
        height: 220px;
        display: block;
      }
      .chart-grid line {
        stroke: var(--grid);
        stroke-width: 1;
      }
      .legend {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
        color: var(--muted);
        font-size: 13px;
      }
      .legend span::before {
        content: "";
        display: inline-block;
        width: 10px;
        height: 10px;
        border-radius: 999px;
        margin-right: 8px;
      }
      .legend .accent::before { background: var(--accent); }
      .legend .accent-2::before { background: var(--accent-2); }
      .legend .warning::before { background: var(--warning); }
      .legend .danger::before { background: var(--danger); }
      .table-wrap {
        overflow-x: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        padding: 12px 10px;
        text-align: left;
        border-bottom: 1px solid rgba(111, 176, 255, 0.12);
        font-size: 14px;
      }
      th {
        color: var(--muted);
        font-weight: 600;
      }
      tr:hover td {
        background: rgba(255, 255, 255, 0.02);
      }
      .quality-chip {
        display: inline-flex;
        align-items: center;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .quality-chip.premium { background: rgba(128, 237, 153, 0.15); color: var(--accent-2); }
      .quality-chip.standard { background: rgba(76, 201, 240, 0.14); color: var(--accent); }
      .quality-chip.discounted { background: rgba(255, 209, 102, 0.12); color: var(--warning); }
      .quality-chip.blocked { background: rgba(255, 107, 107, 0.16); color: var(--danger); }
      .two-column {
        display: grid;
        grid-template-columns: 1.2fr 0.8fr;
        gap: 24px;
      }
      .stack {
        display: grid;
        gap: 18px;
      }
      .event-log {
        display: grid;
        gap: 10px;
        max-height: 360px;
        overflow: auto;
      }
      .event {
        border: 1px solid rgba(111, 176, 255, 0.14);
        border-radius: 14px;
        padding: 12px 14px;
        background: rgba(255, 255, 255, 0.02);
      }
      .event strong { display: block; margin-bottom: 6px; }
      .campaign-card {
        border: 1px solid rgba(111, 176, 255, 0.14);
        border-radius: 16px;
        padding: 14px;
        background: rgba(255, 255, 255, 0.02);
      }
      .campaign-card + .campaign-card {
        margin-top: 14px;
      }
      .small-muted {
        color: var(--muted);
        font-size: 13px;
      }
      @media (max-width: 1100px) {
        .two-column {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 640px) {
        header, main {
          padding-left: 18px;
          padding-right: 18px;
        }
      }
    </style>
  </head>
  <body>
    <header>
      <h1>Quantads Exchange Dashboard</h1>
      <p>Advertiser <strong>${safeAdvertiserId}</strong> · live second-price auction analytics with BCI-aware pricing and fraud defense telemetry.</p>
      <div class="status-bar">
        <span class="pill" id="connection-pill">Connecting to real-time stream…</span>
        <span class="pill" id="last-event-pill">Waiting for events…</span>
      </div>
    </header>
    <main>
      <section class="grid summary-grid" id="summary-grid"></section>

      <section class="panel chart-card">
        <div>
          <h2>Real-time Exchange Curves</h2>
          <p class="small-muted">Live WebSocket updates show clearing price, attention weighted bid strength, and suspicious traffic rate.</p>
        </div>
        <div class="legend">
          <span class="accent">Average clearing price</span>
          <span class="accent-2">Attention weighted bid</span>
          <span class="danger">Suspicious traffic rate</span>
        </div>
        <div class="chart"><svg id="timeline-chart" viewBox="0 0 900 220" preserveAspectRatio="none"></svg></div>
      </section>

      <section class="two-column">
        <div class="stack">
          <section class="panel chart-card">
            <div>
              <h2>Quality Mix</h2>
              <p class="small-muted">Traffic quality segmentation from heuristics plus Isolation Forest scoring.</p>
            </div>
            <div class="chart"><svg id="quality-chart" viewBox="0 0 520 220" preserveAspectRatio="none"></svg></div>
          </section>

          <section class="panel">
            <h2>Campaign Snapshots</h2>
            <div id="campaigns"></div>
          </section>
        </div>

        <div class="stack">
          <section class="panel">
            <h2>Top Creatives</h2>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Creative</th>
                    <th>Win rate</th>
                    <th>Spend</th>
                    <th>Attention</th>
                  </tr>
                </thead>
                <tbody id="creative-table"></tbody>
              </table>
            </div>
          </section>

          <section class="panel">
            <h2>Live Auctions</h2>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Auction</th>
                    <th>Winner</th>
                    <th>2nd price</th>
                    <th>Fraud avg</th>
                  </tr>
                </thead>
                <tbody id="auction-table"></tbody>
              </table>
            </div>
          </section>

          <section class="panel">
            <h2>Event Stream</h2>
            <div class="event-log" id="event-log"></div>
          </section>
        </div>
      </section>
    </main>
    <script>
      const advertiserId = ${JSON.stringify(safeAdvertiserId)};
      const authToken = decodeURIComponent(${JSON.stringify(safeToken)});
      const summaryGrid = document.getElementById("summary-grid");
      const creativeTable = document.getElementById("creative-table");
      const auctionTable = document.getElementById("auction-table");
      const eventLog = document.getElementById("event-log");
      const campaigns = document.getElementById("campaigns");
      const connectionPill = document.getElementById("connection-pill");
      const lastEventPill = document.getElementById("last-event-pill");
      const timelineChart = document.getElementById("timeline-chart");
      const qualityChart = document.getElementById("quality-chart");
      const state = {
        snapshot: null,
        events: []
      };

      const formatNumber = (value, digits = 2) => Number(value || 0).toFixed(digits);
      const currency = (value) => "$" + formatNumber(value, 2);
      const percent = (value) => formatNumber((value || 0) * 100, 1) + "%";
      const labelize = (value) => String(value || "").replace(/[-_]/g, " ");

      const summaryCards = (snapshot) => [
        ["Accepted bids", snapshot.summary.acceptedBids, percent(snapshot.summary.acceptedBids / Math.max(snapshot.summary.totalRequests, 1)) + " of traffic"],
        ["Wins", snapshot.summary.wins, percent(snapshot.summary.winRate) + " win rate"],
        ["Spend", currency(snapshot.summary.totalSpend), currency(snapshot.summary.totalClearingSpend) + " clearing spend"],
        ["Attention", formatNumber(snapshot.summary.averageAttentionScore, 3), "avg BCI attention score"],
        ["Fraud", formatNumber(snapshot.summary.averageFraudScore, 3), percent(snapshot.summary.suspiciousTrafficRate) + " suspicious traffic"],
        ["Estimated ROAS", formatNumber(snapshot.summary.estimatedRoas, 2) + "x", formatNumber(snapshot.summary.estimatedOutcomes, 1) + " projected outcomes"]
      ];

      const drawGrid = (svg, width, height) => {
        const ns = "http://www.w3.org/2000/svg";
        const group = document.createElementNS(ns, "g");
        group.setAttribute("class", "chart-grid");
        for (let index = 0; index <= 4; index += 1) {
          const y = 16 + (height - 32) * (index / 4);
          const line = document.createElementNS(ns, "line");
          line.setAttribute("x1", "0");
          line.setAttribute("x2", String(width));
          line.setAttribute("y1", String(y));
          line.setAttribute("y2", String(y));
          group.appendChild(line);
        }
        return group;
      };

      const createPath = (points, color) => {
        const ns = "http://www.w3.org/2000/svg";
        const path = document.createElementNS(ns, "path");
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", color);
        path.setAttribute("stroke-width", "3");
        path.setAttribute("stroke-linejoin", "round");
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("d", points.map((point, index) => (index === 0 ? "M" : "L") + point[0] + " " + point[1]).join(" "));
        return path;
      };

      const drawTimeline = (timeline) => {
        timelineChart.innerHTML = "";
        const width = 900;
        const height = 220;
        timelineChart.appendChild(drawGrid(timelineChart, width, height));
        if (!timeline.length) {
          return;
        }
        const maxValue = Math.max(
          ...timeline.map((point) => point.averageClearingPrice),
          ...timeline.map((point) => point.attentionWeightedBid),
          ...timeline.map((point) => point.suspiciousTrafficRate * 10),
          1
        );
        const toPoint = (index, value) => {
          const x = 24 + ((width - 48) * index) / Math.max(timeline.length - 1, 1);
          const y = height - 24 - ((height - 48) * value) / maxValue;
          return [x, y];
        };
        timelineChart.appendChild(createPath(timeline.map((point, index) => toPoint(index, point.averageClearingPrice)), "#4cc9f0"));
        timelineChart.appendChild(createPath(timeline.map((point, index) => toPoint(index, point.attentionWeightedBid)), "#80ed99"));
        timelineChart.appendChild(createPath(timeline.map((point, index) => toPoint(index, point.suspiciousTrafficRate * 10)), "#ff6b6b"));
      };

      const drawQuality = (qualityBreakdown) => {
        qualityChart.innerHTML = "";
        const ns = "http://www.w3.org/2000/svg";
        const width = 520;
        const height = 220;
        qualityChart.appendChild(drawGrid(qualityChart, width, height));
        const colors = { premium: "#80ed99", standard: "#4cc9f0", discounted: "#ffd166", blocked: "#ff6b6b" };
        const maxRequests = Math.max(...qualityBreakdown.map((row) => row.requests), 1);
        qualityBreakdown.forEach((row, index) => {
          const bar = document.createElementNS(ns, "rect");
          const barWidth = 90;
          const gap = 28;
          const x = 28 + index * (barWidth + gap);
          const barHeight = ((height - 60) * row.requests) / maxRequests;
          bar.setAttribute("x", String(x));
          bar.setAttribute("y", String(height - 28 - barHeight));
          bar.setAttribute("width", String(barWidth));
          bar.setAttribute("height", String(barHeight));
          bar.setAttribute("rx", "14");
          bar.setAttribute("fill", colors[row.tier] || "#4cc9f0");
          qualityChart.appendChild(bar);
          const label = document.createElementNS(ns, "text");
          label.setAttribute("x", String(x));
          label.setAttribute("y", String(height - 8));
          label.setAttribute("fill", "#95add3");
          label.setAttribute("font-size", "12");
          label.textContent = labelize(row.tier);
          qualityChart.appendChild(label);
        });
      };

      const renderSummary = (snapshot) => {
        summaryGrid.innerHTML = summaryCards(snapshot).map((card) => {
          return '<article class="panel"><div class="metric-label">' + card[0] + '</div><div class="metric-value">' + card[1] + '</div><div class="metric-meta">' + card[2] + '</div></article>';
        }).join("");
      };

      const renderCreatives = (snapshot) => {
        creativeTable.innerHTML = snapshot.topCreatives.map((creative) => {
          return '<tr><td>' + creative.creativeId + '</td><td>' + percent(creative.winRate) + '</td><td>' + currency(creative.spend) + '</td><td>' + formatNumber(creative.averageAttentionScore, 3) + '</td></tr>';
        }).join("");
      };

      const renderAuctions = (snapshot) => {
        auctionTable.innerHTML = snapshot.liveAuctions.map((auction) => {
          const winner = auction.winner ? auction.winner.advertiserId + ' / ' + auction.winner.creativeId : 'pending';
          return '<tr><td>' + auction.auctionId + '<div class="small-muted">' + auction.slotId + '</div></td><td>' + winner + '</td><td>' + currency(auction.secondPrice || 0) + '</td><td>' + formatNumber(auction.averageFraudScore, 3) + '</td></tr>';
        }).join("");
      };

      const renderCampaigns = (snapshot) => {
        campaigns.innerHTML = snapshot.campaignSnapshots.map((campaign) => {
          const quality = campaign.qualityBreakdown.map((row) => {
            return '<span class="quality-chip ' + row.tier + '">' + row.tier + ': ' + percent(row.winRate) + '</span>';
          }).join(' ');
          return '<article class="campaign-card"><h3>' + campaign.campaignId + '</h3><p class="small-muted">Slots: ' + campaign.slotIds.join(', ') + '</p><div class="status-bar">' + quality + '</div><p class="small-muted">Wins: ' + campaign.summary.wins + ' · Spend: ' + currency(campaign.summary.totalSpend) + ' · Fraud: ' + formatNumber(campaign.summary.averageFraudScore, 3) + '</p></article>';
        }).join("");
      };

      const renderEvents = () => {
        eventLog.innerHTML = state.events.slice(0, 10).map((event) => {
          return '<div class="event"><strong>' + labelize(event.eventType) + '</strong><div class="small-muted">Creative ' + event.creativeId + ' · Auction ' + event.auctionId + '</div><div class="small-muted">Bid ' + currency(event.payload.bidAmount) + ' · Clearing ' + currency(event.payload.clearingPrice || 0) + ' · Fraud ' + formatNumber(event.payload.fraudScore, 3) + '</div></div>';
        }).join("");
      };

      const hydrate = (snapshot) => {
        state.snapshot = snapshot;
        renderSummary(snapshot);
        renderCreatives(snapshot);
        renderAuctions(snapshot);
        renderCampaigns(snapshot);
        drawTimeline(snapshot.timeline || []);
        drawQuality(snapshot.qualityBreakdown || []);
      };

      const connect = () => {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const socket = new WebSocket(protocol + '//' + window.location.host + '/ws/analytics?advertiserId=' + encodeURIComponent(advertiserId) + '&token=' + encodeURIComponent(authToken));
        socket.addEventListener("open", () => {
          connectionPill.textContent = "Live WebSocket connected";
        });
        socket.addEventListener("message", (message) => {
          const envelope = JSON.parse(message.data);
          if (envelope.type === "hello") {
            hydrate(envelope.payload.snapshot);
            return;
          }
          if (envelope.type === "event") {
            state.events.unshift(envelope.payload.event);
            renderEvents();
            hydrate(envelope.payload.snapshot);
            lastEventPill.textContent = 'Last event: ' + labelize(envelope.payload.event.eventType) + ' @ ' + new Date(envelope.payload.event.occurredAt).toLocaleTimeString();
            return;
          }
          if (envelope.type === "heartbeat") {
            connectionPill.textContent = 'Live WebSocket connected · ' + new Date(envelope.generatedAt).toLocaleTimeString();
          }
        });
        socket.addEventListener("close", () => {
          connectionPill.textContent = "Disconnected · retrying in 2s";
          setTimeout(connect, 2000);
        });
        socket.addEventListener("error", () => {
          connectionPill.textContent = "Realtime stream error";
        });
      };

      fetch('/api/v1/exchange/analytics/advertisers/' + encodeURIComponent(advertiserId), {
        headers: { authorization: 'Bearer ' + authToken }
      })
        .then((response) => response.json())
        .then((snapshot) => {
          hydrate(snapshot);
        })
        .catch(() => {
          connectionPill.textContent = 'Failed to load initial snapshot';
        })
        .finally(connect);
    </script>
  </body>
</html>`;
};
