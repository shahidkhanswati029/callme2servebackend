import { JobStatus, LedgerKind, PackageTier, PaymentRail, Seat } from "@prisma/client";
import { prisma } from "../../shared/db/prisma";
import { AppError } from "../../shared/errors/AppError";
import { referrerService } from "../referrer/referrer.service";
import { toPublicAccount } from "../identity/identity.types";

const PACKAGE_PRICE_PKR: Record<PackageTier, number> = {
  FREE: 0,
  SILVER: 1500,
  GOLD: 3500,
  PLATINUM: 6000,
};

const PACKAGE_RATE: Record<PackageTier, number> = {
  FREE: 12,
  SILVER: 9,
  GOLD: 6,
  PLATINUM: 2,
};

export const paymentsService = {
  rates() {
    return { packages: PACKAGE_PRICE_PKR, commissionPercent: PACKAGE_RATE };
  },

  async earnings(accountId: string) {
    const lines = await prisma.ledgerLine.findMany({
      where: { accountId },
      orderBy: { createdAt: "desc" },
      take: 80,
    });
    const sumBy = async (kind: LedgerKind) => {
      const a = await prisma.ledgerLine.aggregate({
        where: { accountId, kind },
        _sum: { amount: true },
      });
      return a._sum.amount || 0;
    };
    const net = await sumBy(LedgerKind.NET_PAYOUT);
    const referral = await sumBy(LedgerKind.REFERRAL_SHARE);
    const released = await sumBy(LedgerKind.PAYOUT_RELEASE);
    return {
      available: Math.round((net + referral - released) * 100) / 100,
      netEarned: net,
      referralEarned: referral,
      released,
      lines,
    };
  },

  async setPayoutDestination(
    accountId: string,
    input: { rail: PaymentRail; last4?: string; token?: string },
  ) {
    const updated = await prisma.account.update({
      where: { id: accountId },
      data: {
        payoutRail: input.rail,
        payoutLast4: input.last4 || null,
        payoutToken: input.token || `manual_${input.rail.toLowerCase()}`,
        payoutAccountSet: true,
      },
    });
    return toPublicAccount(updated);
  },

  async payPackage(
    accountId: string,
    input: {
      package: PackageTier;
      rail: PaymentRail;
      cardNumber?: string;
      cardName?: string;
      cardExpiry?: string;
      cardCvc?: string;
      returnUrl?: string;
      cancelUrl?: string;
    },
  ) {
    // Production path: PaymentTransaction + provider adapters (sandbox succeeds immediately).
    const { gatewayService } = await import("./gateway.service");
    return gatewayService.startPackagePayment(accountId, {
      package: input.package,
      rail: input.rail,
      cardNumber: input.cardNumber,
      returnUrl: input.returnUrl,
      cancelUrl: input.cancelUrl,
    });
  },

  /** Sandbox complete-job flow so referrer + earnings can be tested without Stripe. */
  async completeSandboxJob(
    workerId: string,
    input: { askerId?: string; quotation: number; visitFee: number; rail?: PaymentRail },
  ) {
    const worker = await prisma.account.findUnique({ where: { id: workerId } });
    if (!worker || worker.seat !== Seat.EXPERT) {
      throw new AppError("Expert only", 403, "WRONG_SEAT");
    }
    const askerId = input.askerId || workerId;
    const total = input.quotation + input.visitFee;
    const rate = PACKAGE_RATE[worker.package];
    const commission = Math.round(total * (rate / 100) * 100) / 100;
    const net = Math.round((total - commission) * 100) / 100;
    const rail = input.rail || PaymentRail.JAZZCASH;
    if (rail === PaymentRail.CASH) {
      throw new AppError("Cash payments are not available", 400, "CASH_DISABLED");
    }

    const result = await prisma.$transaction(async (tx) => {
      const job = await tx.job.create({
        data: {
          askerId,
          workerId,
          quotation: input.quotation,
          visitFee: input.visitFee,
          currency: worker.currency,
          packageRate: rate,
          commission,
          netToWorker: net,
          status: JobStatus.COMPLETED,
          rail,
          completedAt: new Date(),
        },
      });

      await tx.ledgerLine.createMany({
        data: [
          {
            accountId: workerId,
            jobId: job.id,
            kind: LedgerKind.QUOTATION,
            rail,
            amount: input.quotation,
            currency: worker.currency,
          },
          {
            accountId: workerId,
            jobId: job.id,
            kind: LedgerKind.VISIT_FEE,
            rail,
            amount: input.visitFee,
            currency: worker.currency,
          },
          {
            jobId: job.id,
            kind: LedgerKind.COMMISSION,
            rail,
            amount: commission,
            currency: worker.currency,
            note: `Company ${rate}%`,
          },
          {
            accountId: workerId,
            jobId: job.id,
            kind: LedgerKind.NET_PAYOUT,
            rail,
            amount: net,
            currency: worker.currency,
            note: "Expert net",
          },
          {
            accountId: workerId,
            jobId: job.id,
            kind: LedgerKind.PAYOUT_RELEASE,
            rail,
            amount: net,
            currency: worker.currency,
            note: "Auto-released on pay — desk does not gate",
          },
        ],
      });

      await referrerService.creditFromCommission(
        workerId,
        job.id,
        commission,
        worker.currency,
        tx,
      );

      return job;
    });

    return {
      job: result,
      commission,
      net,
      currency: worker.currency,
    };
  },

  async requestPayoutRelease(accountId: string, amount: number) {
    const earnings = await this.earnings(accountId);
    if (amount <= 0 || amount > earnings.available + 0.001) {
      throw new AppError("Amount exceeds available balance", 400, "INSUFFICIENT");
    }
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account?.payoutAccountSet) {
      throw new AppError("Set a payout destination first", 400, "PAYOUT_DEST_REQUIRED");
    }
    if (account.payoutRail === PaymentRail.CASH) {
      throw new AppError("Cash payouts are not available — pick another rail", 400, "CASH_DISABLED");
    }
    const line = await prisma.ledgerLine.create({
      data: {
        accountId,
        kind: LedgerKind.PAYOUT_RELEASE,
        rail: account.payoutRail || PaymentRail.JAZZCASH,
        amount,
        currency: account.currency,
        note: "Expert payout release (no desk approval)",
      },
    });
    return line;
  },
};
