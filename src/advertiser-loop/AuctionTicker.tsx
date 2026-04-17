import {
  AuctionTickerViewModel,
  BidAutopilotDecision,
  CampaignDuel,
  CompetitorAlert,
  RoiStreak,
  Subscription,
  TickerAlertPanel,
  TickerAutopilotPanel,
  TickerDuelPanel,
  TickerEvent,
  TickerLane,
  TickerSummaryCard,
  average,
  formatCurrency,
  round,
  severityWeight,
  sortByTsDescending
} from "./models";

export interface AuctionTickerProps {
  duelFeed: CampaignDuel[];
  eventFeed: TickerEvent[];
  alerts: CompetitorAlert[];
  streaks: RoiStreak[];
  autopilotDecisions: BidAutopilotDecision[];
  maxEventsPerLane?: number;
  maxDuels?: number;
  generatedAt?: string;
}

export interface AuctionTickerState {
  duelFeed: CampaignDuel[];
  eventFeed: TickerEvent[];
  alerts: CompetitorAlert[];
  streaks: RoiStreak[];
  autopilotDecisions: BidAutopilotDecision[];
  maxEventsPerLane: number;
  maxDuels: number;
  generatedAt: string;
}

export interface AuctionTickerSnapshot {
  state: AuctionTickerState;
  viewModel: AuctionTickerViewModel;
}

export interface AuctionTickerMutation {
  type:
    | "append-events"
    | "upsert-duels"
    | "push-alerts"
    | "push-streaks"
    | "push-autopilot"
    | "hydrate";
  events?: TickerEvent[];
  duels?: CampaignDuel[];
  alerts?: CompetitorAlert[];
  streaks?: RoiStreak[];
  autopilotDecisions?: BidAutopilotDecision[];
  snapshot?: Partial<AuctionTickerState>;
  generatedAt?: string;
}

const DEFAULT_MAX_EVENTS_PER_LANE = 12;
const DEFAULT_MAX_DUELS = 4;
const laneOrder = ["market", "duel", "autopilot", "alert", "roi"] as const;

const dedupeById = <T,>(items: T[], getId: (item: T) => string): T[] => {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const id = getId(item);
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(item);
  }

  return result;
};

const dedupeAlertByHeadline = (alerts: CompetitorAlert[]): CompetitorAlert[] => {
  const seen = new Set<string>();
  const result: CompetitorAlert[] = [];

  for (const alert of alerts) {
    const key = `${alert.campaignId}:${alert.headline}:${alert.createdAt}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(alert);
  }

  return result;
};

const laneTitle = (laneId: string): string => {
  switch (laneId) {
    case "market":
      return "Market heat";
    case "duel":
      return "Campaign duels";
    case "autopilot":
      return "Bid autopilot";
    case "alert":
      return "Competitor alerts";
    case "roi":
      return "ROI streaks";
    default:
      return laneId;
  }
};

const isCritical = (alerts: CompetitorAlert[]): boolean => alerts.some((alert) => alert.severity === "critical");

const buildSummaryCards = (
  duels: CampaignDuel[],
  alerts: CompetitorAlert[],
  streaks: RoiStreak[],
  decisions: BidAutopilotDecision[]
): TickerSummaryCard[] => {
  const activeDuels = duels.filter((duel) => duel.status === "active").length;
  const hottestDuel = [...duels].sort((left, right) => right.segment.attentionScore - left.segment.attentionScore)[0];
  const averageStreakLength = average(streaks.map((streak) => streak.profitableDays));
  const avgLift = average(decisions.map((decision) => decision.expectedLift));
  const criticalAlerts = alerts.filter((alert) => alert.severity === "critical").length;

  return [
    {
      id: "live-duels",
      label: "Live duels",
      value: `${activeDuels}`,
      tone: activeDuels > 0 ? "positive" : "neutral",
      detail: hottestDuel ? `${hottestDuel.segment.segmentName} is hottest at ${round(hottestDuel.segment.attentionScore * 100, 1)}% attention` : "No live duel is active"
    },
    {
      id: "market-pressure",
      label: "Critical alerts",
      value: `${criticalAlerts}`,
      tone: criticalAlerts > 0 ? "critical" : "neutral",
      detail: criticalAlerts > 0 ? "Budget defense or rank loss needs attention" : "No red alerts currently active"
    },
    {
      id: "streaks",
      label: "Avg ROI streak",
      value: `${round(averageStreakLength, 1)} days`,
      tone: averageStreakLength >= 5 ? "positive" : "neutral",
      detail: streaks.length ? `${streaks.filter((streak) => streak.profitableDays >= 7).length} campaigns are on a heater` : "No streak data yet"
    },
    {
      id: "autopilot-lift",
      label: "Avg autopilot lift",
      value: `${round(avgLift, 1)}%`,
      tone: avgLift >= 10 ? "positive" : "warning",
      detail: decisions.length ? `${decisions.length} AI decisions are queued` : "Autopilot has no open recommendations"
    }
  ];
};

const buildAutopilotPanel = (decisions: BidAutopilotDecision[]): TickerAutopilotPanel => {
  const averageLift = round(average(decisions.map((decision) => decision.expectedLift)), 2);
  const averageSavings = round(average(decisions.map((decision) => decision.expectedSavings)), 2);
  const enabledCampaigns = new Set(decisions.map((decision) => decision.campaignId)).size;
  const trustHeadline = !decisions.length
    ? "Autopilot is standing by for the next attention spike."
    : averageLift >= 12
      ? `Autopilot is chasing ${averageLift}% modeled lift while protecting ${formatCurrency(averageSavings)} average savings.`
      : `Autopilot is optimizing gently, preserving ${formatCurrency(averageSavings)} average savings.`;

  return {
    enabledCampaigns,
    decisions: sortByTsDescending(decisions, (decision) => decision.createdAt).slice(0, 6),
    averageLift,
    averageSavings,
    trustHeadline
  };
};

const buildAlertPanel = (alerts: CompetitorAlert[]): TickerAlertPanel => {
  const sorted = [...alerts].sort((left, right) => {
    if (right.urgencyScore !== left.urgencyScore) {
      return right.urgencyScore - left.urgencyScore;
    }
    return Date.parse(right.createdAt) - Date.parse(left.createdAt);
  });

  return {
    total: alerts.length,
    critical: alerts.filter((alert) => alert.severity === "critical").length,
    warning: alerts.filter((alert) => alert.severity === "warning").length,
    informational: alerts.filter((alert) => alert.severity === "info").length,
    highlights: sorted.slice(0, 6)
  };
};

const buildDuelPanel = (duels: CampaignDuel[], maxDuels: number): TickerDuelPanel => {
  const liveRounds = duels
    .map((duel) => ({ duel, latestRound: duel.rounds[duel.rounds.length - 1] }))
    .filter((entry) => entry.latestRound)
    .sort((left, right) => {
      const leftHeat = left.latestRound?.heat ?? 0;
      const rightHeat = right.latestRound?.heat ?? 0;
      return rightHeat - leftHeat;
    })
    .slice(0, maxDuels);

  return {
    activeDuels: duels.filter((duel) => duel.status === "active").length,
    topDuels: liveRounds.map((entry) => {
      const leader = entry.duel.contestants.find((contestant) => contestant.contestantId === entry.duel.currentLeaderId) ?? entry.duel.contestants[0];
      return {
        duelId: entry.duel.duelId,
        segmentName: entry.duel.segment.segmentName,
        leaderName: leader.campaignName,
        pressure: entry.latestRound?.audiencePressure ?? entry.duel.segment.categoryPressure,
        heat: entry.latestRound?.heat ?? entry.duel.segment.attentionScore
      };
    })
  };
};

const pickFeedEvents = (state: AuctionTickerState): TickerEvent[] => {
  const duelEvents = state.duelFeed.flatMap((duel) => {
    const latestRound = duel.rounds[duel.rounds.length - 1];
    const leader = duel.contestants.find((contestant) => contestant.contestantId === duel.currentLeaderId) ?? duel.contestants[0];

    const generated: TickerEvent[] = [
      {
        eventId: `duel:${duel.duelId}:${duel.updatedAt}`,
        category: "duel",
        ts: duel.updatedAt,
        headline: `${leader.campaignName} leads ${duel.segment.segmentName}`,
        body: latestRound
          ? `Heat ${round(latestRound.heat * 100, 1)} · pressure ${round(latestRound.audiencePressure, 2)}x · leader ${leader.campaignName}`
          : `Duel opened for ${duel.segment.segmentName}`,
        value: latestRound?.heat,
        segmentId: duel.segment.segmentId,
        segmentName: duel.segment.segmentName,
        actor: {
          advertiserId: leader.advertiserId,
          campaignId: leader.campaignId,
          displayName: leader.campaignName
        },
        tags: ["duel", duel.status, duel.segment.category],
        metadata: {
          duelId: duel.duelId,
          heat: latestRound?.heat ?? duel.segment.attentionScore,
          pressure: latestRound?.audiencePressure ?? duel.segment.categoryPressure,
          roundCount: duel.rounds.length
        }
      }
    ];

    if (duel.settlement) {
      const winner = duel.contestants.find((contestant) => contestant.contestantId === duel.settlement?.winnerContestantId) ?? leader;
      generated.push({
        eventId: `settlement:${duel.settlement.settlementId}`,
        category: "duel",
        ts: duel.settlement.settledAt,
        headline: `${winner.campaignName} claimed ${duel.settlement.winnerVisibilityMultiplier}x visibility`,
        body: `Loser refund ${formatCurrency(duel.settlement.loserRefundAmount)} paid as competitive protection.`,
        value: duel.settlement.winnerVisibilityMultiplier,
        segmentId: duel.segment.segmentId,
        segmentName: duel.segment.segmentName,
        actor: {
          advertiserId: winner.advertiserId,
          campaignId: winner.campaignId,
          displayName: winner.campaignName
        },
        tags: ["duel", "settled", duel.segment.category],
        metadata: {
          settlementId: duel.settlement.settlementId,
          refund: duel.settlement.loserRefundAmount,
          reason: duel.settlement.reason
        }
      });
    }

    return generated;
  });

  const streakEvents = state.streaks.map<TickerEvent>((streak) => ({
    eventId: `streak:${streak.campaignId}:${streak.profitableDays}:${streak.currentRoas}`,
    category: "roi",
    ts: streak.lastProfitDate ?? state.generatedAt,
    headline: `${streak.campaignId} is on a ${streak.profitableDays}-day streak`,
    body: `${streak.statusLabel} · ${round(streak.currentRoas, 2)}x current ROAS · momentum ${streak.momentum}`,
    value: streak.profitableDays,
    tags: ["roi", streak.momentum, streak.advertiserId],
    metadata: {
      campaignId: streak.campaignId,
      advertiserId: streak.advertiserId,
      currentRoas: streak.currentRoas,
      targetRoas: streak.targetRoas,
      longestProfitableDays: streak.longestProfitableDays
    }
  }));

  const autopilotEvents = state.autopilotDecisions.map<TickerEvent>((decision) => ({
    eventId: `autopilot:${decision.decisionId}`,
    category: "autopilot",
    ts: decision.createdAt,
    headline: `${decision.campaignId} autopilot ${decision.percentChange >= 0 ? "raise" : "trim"} ${round(Math.abs(decision.percentChange), 1)}%`,
    body: decision.trustMessage,
    value: decision.recommendedBid,
    changePercent: decision.percentChange,
    segmentId: decision.segmentId,
    tags: ["autopilot", decision.advertiserId, decision.campaignId],
    metadata: {
      campaignId: decision.campaignId,
      currentBid: decision.currentBid,
      recommendedBid: decision.recommendedBid,
      expectedLift: decision.expectedLift,
      expectedSavings: decision.expectedSavings,
      confidence: decision.confidence
    }
  }));

  const alertEvents = state.alerts.map<TickerEvent>((alert) => ({
    eventId: `alert:${alert.alertId}`,
    category: "alert",
    ts: alert.createdAt,
    headline: alert.headline,
    body: `${alert.summary} ${alert.recommendedAction}`,
    value: alert.deltaValue,
    changePercent: alert.deltaPercent,
    segmentId: alert.segmentId,
    severity: alert.severity,
    tags: ["alert", alert.type, alert.category],
    metadata: {
      alertId: alert.alertId,
      campaignId: alert.campaignId,
      urgencyScore: alert.urgencyScore,
      status: alert.status
    }
  }));

  return dedupeById(
    sortByTsDescending([...state.eventFeed, ...duelEvents, ...streakEvents, ...autopilotEvents, ...alertEvents], (event) => event.ts),
    (event) => event.eventId
  );
};

const mapEventToLane = (event: TickerEvent): string => {
  if (event.category === "bid" || event.category === "market" || event.category === "heatmap") {
    return "market";
  }
  if (event.category === "autopilot") {
    return "autopilot";
  }
  if (event.category === "alert") {
    return "alert";
  }
  if (event.category === "roi") {
    return "roi";
  }
  return "duel";
};

const buildLanes = (events: TickerEvent[], maxEventsPerLane: number): TickerLane[] => {
  const grouped = new Map<string, TickerEvent[]>();

  for (const laneId of laneOrder) {
    grouped.set(laneId, []);
  }

  for (const event of events) {
    const laneId = mapEventToLane(event);
    const lane = grouped.get(laneId) ?? [];
    lane.push(event);
    grouped.set(laneId, lane);
  }

  return laneOrder.map((laneId) => ({
    laneId,
    title: laneTitle(laneId),
    events: (grouped.get(laneId) ?? []).slice(0, maxEventsPerLane)
  }));
};

const buildHeadline = (state: AuctionTickerState, alerts: CompetitorAlert[], decisions: BidAutopilotDecision[]): string => {
  const liveDuel = [...state.duelFeed].sort((left, right) => right.segment.attentionScore - left.segment.attentionScore)[0];
  const hottestDecision = [...decisions].sort((left, right) => right.expectedLift - left.expectedLift)[0];
  const alertTone = isCritical(alerts)
    ? "Red-alert market"
    : alerts.some((alert) => alert.severity === "warning")
      ? "Competitive market"
      : "Calm market";

  if (liveDuel && hottestDecision) {
    return `${alertTone}: ${liveDuel.segment.segmentName} is peaking while autopilot models ${round(hottestDecision.expectedLift, 1)}% lift.`;
  }
  if (liveDuel) {
    return `${alertTone}: ${liveDuel.segment.segmentName} is the live attention arena.`;
  }
  if (hottestDecision) {
    return `${alertTone}: autopilot is monitoring ${hottestDecision.campaignId} for the next bid breakout.`;
  }
  return `${alertTone}: no live auction drama yet, but the ticker is armed.`;
};

export const renderAuctionTicker = (props: AuctionTickerProps): AuctionTickerViewModel => {
  const state = createAuctionTickerState(props);
  return buildViewModel(state);
};

export const createAuctionTickerState = (props: AuctionTickerProps): AuctionTickerState => {
  return {
    duelFeed: [...props.duelFeed],
    eventFeed: sortByTsDescending([...props.eventFeed], (event) => event.ts),
    alerts: dedupeAlertByHeadline(sortByTsDescending([...props.alerts], (alert) => alert.createdAt)),
    streaks: sortByTsDescending([...props.streaks], (streak) => streak.lastProfitDate ?? props.generatedAt ?? new Date().toISOString()),
    autopilotDecisions: sortByTsDescending([...props.autopilotDecisions], (decision) => decision.createdAt),
    maxEventsPerLane: props.maxEventsPerLane ?? DEFAULT_MAX_EVENTS_PER_LANE,
    maxDuels: props.maxDuels ?? DEFAULT_MAX_DUELS,
    generatedAt: props.generatedAt ?? new Date().toISOString()
  };
};

export const buildViewModel = (state: AuctionTickerState): AuctionTickerViewModel => {
  const feedEvents = pickFeedEvents(state);
  const lanes = buildLanes(feedEvents, state.maxEventsPerLane);
  const summaryCards = buildSummaryCards(state.duelFeed, state.alerts, state.streaks, state.autopilotDecisions);
  const autopilotPanel = buildAutopilotPanel(state.autopilotDecisions);
  const alertPanel = buildAlertPanel(state.alerts);
  const duelPanel = buildDuelPanel(state.duelFeed, state.maxDuels);
  const streaks = [...state.streaks]
    .sort((left, right) => right.profitableDays - left.profitableDays || right.currentRoas - left.currentRoas)
    .slice(0, 8);

  return {
    generatedAt: state.generatedAt,
    headline: buildHeadline(state, state.alerts, state.autopilotDecisions),
    feed: lanes,
    summaryCards,
    autopilotPanel,
    alertPanel,
    duelPanel,
    streaks
  };
};

export const serializeTicker = (viewModel: AuctionTickerViewModel): string => {
  const summary = viewModel.summaryCards
    .map((card) => `${card.label}: ${card.value} (${card.detail})`)
    .join(" | ");
  const lanes = viewModel.feed
    .map((lane) => `${lane.title}: ${lane.events.map((event) => event.headline).join(" • ")}`)
    .join(" || ");

  return `${viewModel.headline}\n${summary}\n${lanes}`;
};

export class AuctionTickerController {
  private state: AuctionTickerState;
  private listeners = new Set<(snapshot: AuctionTickerSnapshot) => void>();

  constructor(props: AuctionTickerProps) {
    this.state = createAuctionTickerState(props);
  }

  getState(): AuctionTickerState {
    return JSON.parse(JSON.stringify(this.state)) as AuctionTickerState;
  }

  getViewModel(): AuctionTickerViewModel {
    return buildViewModel(this.state);
  }

  getSnapshot(): AuctionTickerSnapshot {
    return {
      state: this.getState(),
      viewModel: this.getViewModel()
    };
  }

  subscribe(listener: (snapshot: AuctionTickerSnapshot) => void): Subscription<AuctionTickerSnapshot> {
    this.listeners.add(listener);
    const current = this.getSnapshot();
    listener(current);

    return {
      current,
      unsubscribe: () => {
        this.listeners.delete(listener);
      }
    };
  }

  dispatch(mutation: AuctionTickerMutation): AuctionTickerSnapshot {
    const generatedAt = mutation.generatedAt ?? new Date().toISOString();

    switch (mutation.type) {
      case "append-events": {
        this.state.eventFeed = sortByTsDescending(
          dedupeById([...mutation.events ?? [], ...this.state.eventFeed], (event) => event.eventId),
          (event) => event.ts
        );
        break;
      }
      case "upsert-duels": {
        const next = new Map(this.state.duelFeed.map((duel) => [duel.duelId, duel]));
        for (const duel of mutation.duels ?? []) {
          next.set(duel.duelId, duel);
        }
        this.state.duelFeed = [...next.values()].sort((left, right) => right.segment.attentionScore - left.segment.attentionScore);
        break;
      }
      case "push-alerts": {
        this.state.alerts = dedupeAlertByHeadline(
          sortByTsDescending([...(mutation.alerts ?? []), ...this.state.alerts], (alert) => alert.createdAt)
        );
        break;
      }
      case "push-streaks": {
        const next = new Map(this.state.streaks.map((streak) => [streak.campaignId, streak]));
        for (const streak of mutation.streaks ?? []) {
          next.set(streak.campaignId, streak);
        }
        this.state.streaks = [...next.values()]
          .sort((left, right) => right.profitableDays - left.profitableDays || right.currentRoas - left.currentRoas);
        break;
      }
      case "push-autopilot": {
        this.state.autopilotDecisions = sortByTsDescending(
          dedupeById([...(mutation.autopilotDecisions ?? []), ...this.state.autopilotDecisions], (decision) => decision.decisionId),
          (decision) => decision.createdAt
        );
        break;
      }
      case "hydrate": {
        this.state = {
          ...this.state,
          ...mutation.snapshot,
          generatedAt
        };
        break;
      }
      default: {
        return this.emit(this.getSnapshot(), mutation, generatedAt);
      }
    }

    this.state.generatedAt = generatedAt;
    return this.emit(this.getSnapshot(), mutation, generatedAt);
  }

  pushAuctionDrama(duel: CampaignDuel): AuctionTickerSnapshot {
    const latestRound = duel.rounds[duel.rounds.length - 1];
    const leader = duel.contestants.find((contestant) => contestant.contestantId === duel.currentLeaderId) ?? duel.contestants[0];

    const derivedEvents: TickerEvent[] = [
      {
        eventId: `headline:${duel.duelId}:${duel.updatedAt}`,
        category: "market",
        ts: duel.updatedAt,
        headline: `${leader.campaignName} is chasing ${duel.segment.segmentName}`,
        body: latestRound
          ? `${leader.campaignName} leads with heat ${round(latestRound.heat * 100, 2)} and ${latestRound.autopilotDecisions.length} autopilot moves queued.`
          : `${duel.segment.segmentName} has a fresh duel opening.`,
        value: latestRound?.heat,
        segmentId: duel.segment.segmentId,
        segmentName: duel.segment.segmentName,
        actor: {
          advertiserId: leader.advertiserId,
          campaignId: leader.campaignId,
          displayName: leader.campaignName
        },
        tags: ["market", duel.segment.category, duel.status],
        metadata: {
          duelId: duel.duelId,
          pressure: latestRound?.audiencePressure ?? duel.segment.categoryPressure,
          roundCount: duel.rounds.length,
          activeAlerts: duel.alertStream.length
        }
      }
    ];

    return this.dispatch({
      type: "hydrate",
      snapshot: {
        duelFeed: [duel, ...this.state.duelFeed.filter((existing) => existing.duelId !== duel.duelId)],
        eventFeed: [...derivedEvents, ...this.state.eventFeed],
        alerts: [...duel.alertStream, ...this.state.alerts],
        autopilotDecisions: [
          ...duel.rounds.flatMap((roundRecord) => roundRecord.autopilotDecisions),
          ...this.state.autopilotDecisions
        ],
        streaks: [...duel.contestants.map((contestant) => contestant.streak), ...this.state.streaks]
      }
    });
  }

  toPlainText(): string {
    return serializeTicker(this.getViewModel());
  }

  private emit(snapshot: AuctionTickerSnapshot, _mutation: AuctionTickerMutation | never, _generatedAt: string): AuctionTickerSnapshot {
    for (const listener of this.listeners) {
      listener(snapshot);
    }
    return snapshot;
  }
}

export const buildTickerHealthScore = (viewModel: AuctionTickerViewModel): number => {
  const duelHeat = average(viewModel.duelPanel.topDuels.map((duel) => duel.heat));
  const alertDrag = sumAlertSeverity(viewModel.alertPanel.highlights) / Math.max(viewModel.alertPanel.total || 1, 1);
  const streakLift = average(viewModel.streaks.map((streak) => streak.profitableDays));
  const autopilotBoost = viewModel.autopilotPanel.averageLift;

  return round(duelHeat * 30 + streakLift * 2 + autopilotBoost - alertDrag * 4, 2);
};

const sumAlertSeverity = (alerts: CompetitorAlert[]): number => {
  return alerts.reduce((total, alert) => total + severityWeight(alert.severity), 0);
};
