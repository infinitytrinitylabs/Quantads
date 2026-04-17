/**
 * PerformanceStreakService
 *
 * Records consecutive days a campaign meets a configurable profitability
 * threshold (ROAS ≥ target). Provides factual, plain-English summaries
 * for reporting; does **not** emit gamified copy (no flames, no
 * "urgency" messaging, no reward loops).
 *
 * Advertisers may use this for honest reporting, and the presentation
 * layer can choose its own visual treatment. The API returns data, not
 * emotional messaging.
 */

export interface DailyPerformanceInput {
  campaignId: string;
  /** YYYY-MM-DD date string (UTC). */
  date: string;
  spend: number;
  revenue: number;
}

export interface DailyPerformanceRecord {
  date: string;
  spend: number;
  revenue: number;
  roas: number;
  profitable: boolean;
}

export interface PerformanceStreak {
  campaignId: string;
  roasThreshold: number;
  currentStreakDays: number;
  longestStreakDays: number;
  lastEvaluatedDate: string | null;
  history: DailyPerformanceRecord[];
}

const DEFAULT_ROAS_THRESHOLD = 1.0;
const MAX_HISTORY_DAYS = 365;

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export class PerformanceStreakService {
  private readonly records = new Map<string, PerformanceStreak>();

  constructor(private readonly roasThreshold: number = DEFAULT_ROAS_THRESHOLD) {}

  recordDay(input: DailyPerformanceInput): PerformanceStreak {
    if (!DATE_REGEX.test(input.date)) {
      throw new Error("date must be a YYYY-MM-DD UTC date string");
    }
    if (input.spend < 0 || input.revenue < 0) {
      throw new Error("spend and revenue must be non-negative");
    }

    let streak = this.records.get(input.campaignId);
    if (!streak) {
      streak = {
        campaignId: input.campaignId,
        roasThreshold: this.roasThreshold,
        currentStreakDays: 0,
        longestStreakDays: 0,
        lastEvaluatedDate: null,
        history: []
      };
      this.records.set(input.campaignId, streak);
    }

    const roas = input.spend > 0 ? input.revenue / input.spend : 0;
    const record: DailyPerformanceRecord = {
      date: input.date,
      spend: Number(input.spend.toFixed(2)),
      revenue: Number(input.revenue.toFixed(2)),
      roas: Number(roas.toFixed(3)),
      profitable: roas >= streak.roasThreshold
    };

    const existingIdx = streak.history.findIndex((h) => h.date === input.date);
    if (existingIdx >= 0) {
      streak.history[existingIdx] = record;
    } else {
      streak.history.push(record);
    }

    streak.history.sort((a, b) => a.date.localeCompare(b.date));
    while (streak.history.length > MAX_HISTORY_DAYS) {
      streak.history.shift();
    }

    this.recomputeStreak(streak);
    return streak;
  }

  getStreak(campaignId: string): PerformanceStreak | null {
    return this.records.get(campaignId) ?? null;
  }

  private recomputeStreak(streak: PerformanceStreak): void {
    let current = 0;
    let longest = 0;
    let previousDate: Date | null = null;

    for (const record of streak.history) {
      const recordDate = new Date(`${record.date}T00:00:00Z`);
      if (!record.profitable) {
        current = 0;
        previousDate = recordDate;
        continue;
      }

      if (previousDate && isConsecutiveDay(previousDate, recordDate)) {
        current += 1;
      } else {
        current = 1;
      }

      if (current > longest) longest = current;
      previousDate = recordDate;
    }

    streak.currentStreakDays = current;
    streak.longestStreakDays = longest;
    streak.lastEvaluatedDate = streak.history.length
      ? streak.history[streak.history.length - 1].date
      : null;
  }
}

function isConsecutiveDay(previous: Date, next: Date): boolean {
  const prev = new Date(previous);
  prev.setUTCDate(prev.getUTCDate() + 1);
  return prev.toISOString().slice(0, 10) === next.toISOString().slice(0, 10);
}

export const performanceStreakService = new PerformanceStreakService();
