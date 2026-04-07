import {
  InvoiceOutcomeLedger,
  OutcomePerformanceSummary,
  OutcomeReportEntry,
  OutcomeReportRequest
} from "../types";

interface RegisterInvoiceInput {
  invoiceId: string;
  campaignId: string;
  advertiserId: string;
  agencyId: string;
  outcomeType: string;
  quotedOutcomeCount: number;
  unitPrice: number;
  quotedAmount: number;
  paymentStatus: "quoted" | "settled";
  settledAmount: number | null;
}

const round = (value: number): number => Number(value.toFixed(2));

export class OutcomeStore {
  private readonly ledgers = new Map<string, InvoiceOutcomeLedger>();

  registerInvoice(input: RegisterInvoiceInput): InvoiceOutcomeLedger {
    const existing = this.ledgers.get(input.invoiceId);

    if (existing) {
      return existing;
    }

    const ledger: InvoiceOutcomeLedger = {
      invoiceId: input.invoiceId,
      campaignId: input.campaignId,
      advertiserId: input.advertiserId,
      agencyId: input.agencyId,
      outcomeType: input.outcomeType,
      quotedOutcomeCount: input.quotedOutcomeCount,
      unitPrice: round(input.unitPrice),
      quotedAmount: round(input.quotedAmount),
      paymentStatus: input.paymentStatus,
      settledAmount: input.settledAmount === null ? null : round(input.settledAmount),
      reportedOutcomeCount: 0,
      billableOutcomeCount: 0,
      outcomeValueGenerated: 0,
      deliveryProgress: 0,
      roas: 0,
      reports: []
    };

    this.ledgers.set(input.invoiceId, ledger);
    return ledger;
  }

  getInvoice(invoiceId: string): InvoiceOutcomeLedger | null {
    return this.ledgers.get(invoiceId) ?? null;
  }

  recordOutcome(report: OutcomeReportRequest): InvoiceOutcomeLedger {
    const ledger = this.ledgers.get(report.invoiceId);

    if (!ledger) {
      throw new Error(`Invoice ${report.invoiceId} was not found`);
    }

    if (ledger.outcomeType !== report.outcomeType) {
      throw new Error(
        `Outcome type '${report.outcomeType}' does not match registered invoice type '${ledger.outcomeType}'`
      );
    }

    const entry: OutcomeReportEntry = {
      outcomeType: report.outcomeType,
      outcomeCount: report.outcomeCount,
      valueGenerated: round(report.valueGenerated),
      verifier: report.verifier,
      transactionHash: report.transactionHash,
      occurredAt: report.occurredAt ?? new Date().toISOString()
    };

    ledger.reports.push(entry);
    ledger.reportedOutcomeCount += report.outcomeCount;
    ledger.billableOutcomeCount = Math.min(ledger.reportedOutcomeCount, ledger.quotedOutcomeCount);
    ledger.outcomeValueGenerated = round(ledger.outcomeValueGenerated + report.valueGenerated);
    ledger.deliveryProgress = round(ledger.billableOutcomeCount / ledger.quotedOutcomeCount);
    const spendBase = ledger.settledAmount ?? ledger.quotedAmount;
    ledger.roas = spendBase > 0 ? round(ledger.outcomeValueGenerated / spendBase) : 0;

    return ledger;
  }

  getPerformanceSummary(campaignId?: string): OutcomePerformanceSummary {
    const ledgers = [...this.ledgers.values()].filter(
      (ledger) => !campaignId || ledger.campaignId === campaignId
    );
    return this.summarizeLedgers(ledgers);
  }

  getPerformanceSummaries(campaignIds: string[]): Record<string, OutcomePerformanceSummary> {
    const summaries = Object.fromEntries(
      campaignIds.map((campaignId) => [campaignId, this.emptySummary()])
    ) as Record<string, OutcomePerformanceSummary>;

    for (const ledger of this.ledgers.values()) {
      const summary = summaries[ledger.campaignId];

      if (!summary) {
        continue;
      }

      this.accumulate(summary, ledger);
    }

    for (const campaignId of campaignIds) {
      summaries[campaignId] = this.finalizeSummary(summaries[campaignId]);
    }

    return summaries;
  }

  private summarizeLedgers(ledgers: InvoiceOutcomeLedger[]): OutcomePerformanceSummary {
    const summary = this.emptySummary();

    for (const ledger of ledgers) {
      this.accumulate(summary, ledger);
    }

    return this.finalizeSummary(summary);
  }

  private accumulate(summary: OutcomePerformanceSummary, ledger: InvoiceOutcomeLedger): void {
    summary.invoices += 1;
    summary.settledInvoices += ledger.paymentStatus === "settled" ? 1 : 0;
    summary.quotedSpend += ledger.quotedAmount;
    summary.settledSpend += ledger.settledAmount ?? 0;
    summary.projectedOutcomes += ledger.quotedOutcomeCount;
    summary.reportedOutcomes += ledger.reportedOutcomeCount;
    summary.billableOutcomes += ledger.billableOutcomeCount;
    summary.outcomeValueGenerated += ledger.outcomeValueGenerated;
  }

  private finalizeSummary(summary: OutcomePerformanceSummary): OutcomePerformanceSummary {
    summary.quotedSpend = round(summary.quotedSpend);
    summary.settledSpend = round(summary.settledSpend);
    summary.outcomeValueGenerated = round(summary.outcomeValueGenerated);
    summary.outcomeBackedRoas =
      summary.quotedSpend > 0 ? round(summary.outcomeValueGenerated / summary.quotedSpend) : 0;
    summary.settlementCoverage =
      summary.quotedSpend > 0 ? round(summary.settledSpend / summary.quotedSpend) : 0;
    return summary;
  }

  private emptySummary(): OutcomePerformanceSummary {
    return {
      invoices: 0,
      settledInvoices: 0,
      quotedSpend: 0,
      settledSpend: 0,
      projectedOutcomes: 0,
      reportedOutcomes: 0,
      billableOutcomes: 0,
      outcomeValueGenerated: 0,
      outcomeBackedRoas: 0,
      settlementCoverage: 0
    };
  }
}

export const outcomeStore = new OutcomeStore();
