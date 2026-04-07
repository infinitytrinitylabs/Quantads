import { randomUUID } from "node:crypto";
import { BiddingEngine } from "../bidding/BiddingEngine";
import {
  createOutcomeQuote,
  OutcomePaymentQuote,
  settleOutcomePayment,
  SettledOutcomePayment
} from "../payments/x402";
import { outcomeStore, OutcomeStore } from "../lib/outcome-store";
import { AuctionBidRequest, AuctionBidResponse, AuctionLeaderboardEntry, AuctionWinnerResponse } from "../types";

interface StoredAuctionBid {
  campaignId: string;
  bidId: string;
  advertiserId: string;
  agencyId: string;
  outcomeType: string;
  finalBid: number;
  reservePrice: number;
  auctionScore: number;
  submittedAt: string;
  paymentStatus: "quoted" | "settled";
  quote: OutcomePaymentQuote;
  settledPayment?: SettledOutcomePayment;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(Math.max(value, minimum), maximum);

const round = (value: number): number => Number(value.toFixed(2));

export class AuctionEngine {
  private readonly biddingEngine = new BiddingEngine();
  private readonly bidsByCampaign = new Map<string, StoredAuctionBid[]>();
  private readonly bidsByInvoice = new Map<string, StoredAuctionBid>();

  constructor(private readonly store: OutcomeStore) {}

  placeBid(campaignId: string, request: AuctionBidRequest): AuctionBidResponse {
    const bidResult = this.biddingEngine.calculateOutcomeBid({
      baseOutcomePrice: request.baseOutcomePrice,
      audience: request.audience,
      marketPressure: request.marketPressure,
      floorPrice: request.floorPrice,
      maxPrice: request.maxPrice,
      riskTolerance: request.riskTolerance
    });

    const reservePrice = round(
      request.reservePrice ??
        request.baseOutcomePrice *
          clamp(request.audience.verifiedLtv / (request.baseOutcomePrice * 4), 1, 1.35)
    );
    const priorityBoost = clamp(request.priorityBoost ?? 1, 0.8, 1.4);
    const expectedRevenuePerOutcome = request.expectedRevenuePerOutcome ?? request.baseOutcomePrice * 2;
    const safeFinalBid = Math.max(bidResult.finalBid, 0.01);
    const marginMultiplier = clamp(expectedRevenuePerOutcome / safeFinalBid, 0.8, 3);
    const auctionScore = round(
      bidResult.finalBid *
        bidResult.breakdown.confidenceMultiplier *
        bidResult.breakdown.ltvMultiplier *
        priorityBoost *
        marginMultiplier
    );

    const quote = createOutcomeQuote({
      agencyId: request.agencyId,
      campaignId,
      outcomeType: request.outcomeType,
      outcomeCount: request.outcomeCount,
      unitPrice: bidResult.finalBid,
      settlementAddress: request.settlementAddress,
      settlementNetwork: request.settlementNetwork,
      currency: request.currency
    });

    let settledPayment: SettledOutcomePayment | undefined;

    if (request.authorization) {
      settledPayment = settleOutcomePayment(quote, {
        invoiceId: quote.invoiceId,
        payerWallet: request.authorization.payerWallet,
        transactionHash: request.authorization.transactionHash,
        amount: request.authorization.amount,
        currency: request.authorization.currency
      });
    }

    const storedBid: StoredAuctionBid = {
      campaignId,
      bidId: randomUUID(),
      advertiserId: request.advertiserId,
      agencyId: request.agencyId,
      outcomeType: request.outcomeType,
      finalBid: bidResult.finalBid,
      reservePrice,
      auctionScore,
      submittedAt: new Date().toISOString(),
      paymentStatus: settledPayment ? "settled" : "quoted",
      quote,
      settledPayment
    };

    const existing = this.bidsByCampaign.get(campaignId) ?? [];
    existing.push(storedBid);
    this.bidsByCampaign.set(campaignId, existing);
    this.bidsByInvoice.set(quote.invoiceId, storedBid);

    this.store.registerInvoice({
      invoiceId: quote.invoiceId,
      campaignId,
      advertiserId: request.advertiserId,
      agencyId: request.agencyId,
      outcomeType: request.outcomeType,
      quotedOutcomeCount: quote.outcomeCount,
      unitPrice: quote.unitPrice,
      quotedAmount: quote.totalAmount,
      paymentStatus: storedBid.paymentStatus,
      settledAmount: settledPayment?.settledAmount ?? null
    });

    const sorted = this.getSortedBids(campaignId);
    const rank = sorted.findIndex((bid) => bid.bidId === storedBid.bidId) + 1;
    const winner = this.findWinnerFromSorted(sorted);

    return {
      campaignId,
      bidId: storedBid.bidId,
      advertiserId: storedBid.advertiserId,
      agencyId: storedBid.agencyId,
      outcomeType: storedBid.outcomeType,
      finalBid: storedBid.finalBid,
      reservePrice,
      auctionScore: storedBid.auctionScore,
      rank,
      isWinning: winner?.bidId === storedBid.bidId,
      recommendedBidToWin:
        winner && winner.bidId !== storedBid.bidId ? round(winner.finalBid + 0.01) : null,
      paymentStatus: storedBid.paymentStatus,
      invoiceId: quote.invoiceId,
      leaderboard: sorted.slice(0, 5).map((bid, index) => this.toLeaderboardEntry(bid, index + 1)),
      quote: {
        invoiceId: quote.invoiceId,
        totalAmount: quote.totalAmount,
        currency: quote.currency,
        paymentEndpoint: quote.paymentEndpoint
      }
    };
  }

  getWinner(campaignId: string): AuctionWinnerResponse {
    const sorted = this.getSortedBids(campaignId);
    const winner = this.findWinnerFromSorted(sorted);

    return {
      campaignId,
      winner: winner
        ? {
            ...this.toLeaderboardEntry(winner, sorted.findIndex((bid) => bid.bidId === winner.bidId) + 1),
            agencyId: winner.agencyId,
            outcomeType: winner.outcomeType,
            reservePrice: winner.reservePrice,
            invoiceId: winner.quote.invoiceId,
            delivery: this.store.getInvoice(winner.quote.invoiceId) ?? undefined
          }
        : null,
      leaderboard: sorted.slice(0, 5).map((bid, index) => this.toLeaderboardEntry(bid, index + 1))
    };
  }

  hasInvoice(invoiceId: string): boolean {
    return this.bidsByInvoice.has(invoiceId);
  }

  private getSortedBids(campaignId: string): StoredAuctionBid[] {
    return [...(this.bidsByCampaign.get(campaignId) ?? [])].sort((left, right) => {
      if (right.auctionScore !== left.auctionScore) {
        return right.auctionScore - left.auctionScore;
      }

      if (right.finalBid !== left.finalBid) {
        return right.finalBid - left.finalBid;
      }

      return left.submittedAt.localeCompare(right.submittedAt);
    });
  }

  private findWinnerFromSorted(sorted: StoredAuctionBid[]): StoredAuctionBid | undefined {
    return sorted.find((bid) => bid.finalBid >= bid.reservePrice);
  }

  private toLeaderboardEntry(bid: StoredAuctionBid, rank: number): AuctionLeaderboardEntry {
    return {
      bidId: bid.bidId,
      advertiserId: bid.advertiserId,
      finalBid: bid.finalBid,
      auctionScore: bid.auctionScore,
      rank,
      paymentStatus: bid.paymentStatus,
      submittedAt: bid.submittedAt
    };
  }
}

export const auctionEngine = new AuctionEngine(outcomeStore);
