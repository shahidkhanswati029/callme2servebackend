import { JobStatus, LedgerKind, PackageTier, PaymentRail, Seat } from "@prisma/client";
import { prisma } from "../../shared/db/prisma";
import { AppError } from "../../shared/errors/AppError";
import { referrerService } from "../referrer/referrer.service";

const PACKAGE_RATE: Record<PackageTier, number> = {
  FREE: 12,
  SILVER: 9,
  GOLD: 6,
  PLATINUM: 2,
};

export const jobsService = {
  async list(accountId: string, page = 1, pageSize = 10) {
    const where = {
      OR: [{ askerId: accountId }, { workerId: accountId }],
    };
    const [total, rows] = await Promise.all([
      prisma.job.count({ where }),
      prisma.job.findMany({
        where,
        include: {
          asker: { select: { id: true, name: true, photoUrl: true } },
          worker: { select: { id: true, name: true, photoUrl: true, package: true } },
          receipt: true,
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, jobs: rows };
  },

  async create(
    askerId: string,
    input: {
      workerId: string;
      quotation: number;
      visitFee: number;
      rail: PaymentRail;
    },
  ) {
    if (askerId === input.workerId) {
      throw new AppError("Cannot hire yourself", 400, "INVALID");
    }
    if (input.quotation <= 0) throw new AppError("Quotation required", 400, "INVALID");
    if (input.visitFee < 0) throw new AppError("Visit fee invalid", 400, "INVALID");

    const [asker, worker] = await Promise.all([
      prisma.account.findUnique({ where: { id: askerId } }),
      prisma.account.findUnique({ where: { id: input.workerId } }),
    ]);
    if (!asker || asker.seat !== Seat.EXPERT) throw new AppError("Asker must be expert", 403, "WRONG_SEAT");
    if (!worker || worker.seat !== Seat.EXPERT) throw new AppError("Worker not found", 404, "NOT_FOUND");

    const rate = PACKAGE_RATE[worker.package];
    const total = input.quotation + input.visitFee;
    const commission = Math.round(total * (rate / 100) * 100) / 100;
    const net = Math.round((total - commission) * 100) / 100;

    const job = await prisma.job.create({
      data: {
        askerId,
        workerId: input.workerId,
        quotation: input.quotation,
        visitFee: input.visitFee,
        currency: asker.currency,
        packageRate: rate,
        commission,
        netToWorker: net,
        status: JobStatus.OPEN,
        rail: input.rail,
      },
    });

    await prisma.notification.create({
      data: {
        accountId: input.workerId,
        kind: "JOB",
        title: "New job ask",
        body: `${asker.name} asked ${asker.currency} ${total.toLocaleString()} · ${input.rail}`,
        data: { jobId: job.id },
      },
    });

    return job;
  },

  async accept(workerId: string, jobId: string) {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job || job.workerId !== workerId) throw new AppError("Job not found", 404, "NOT_FOUND");
    if (job.status !== JobStatus.OPEN) throw new AppError("Job is not open", 400, "INVALID_STATUS");

    const updated = await prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.ACCEPTED },
    });

    await prisma.notification.create({
      data: {
        accountId: job.askerId,
        kind: "JOB",
        title: "Job accepted",
        body: "The expert accepted your ask. Pay to complete when work is done.",
        data: { jobId },
      },
    });

    return updated;
  },

  /** Asker pays / completes — sandbox settles now; live returns provider checkout until webhook. */
  async complete(
    askerId: string,
    jobId: string,
    input: {
      rail: PaymentRail;
      walletPhone?: string;
      accountEmail?: string;
      cardNumber?: string;
      cardName?: string;
      cardExpiry?: string;
      cardCvc?: string;
      returnUrl?: string;
      cancelUrl?: string;
    },
  ) {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { worker: true, asker: true },
    });
    if (!job || job.askerId !== askerId) throw new AppError("Job not found", 404, "NOT_FOUND");
    if (job.status !== JobStatus.ACCEPTED) {
      throw new AppError("Worker must accept before you can pay", 400, "INVALID_STATUS");
    }

    const payRail = input.rail;
    let payNote = `${payRail}`;
    let last4: string | undefined;
    let customerPhone: string | undefined;
    let customerEmail: string | undefined;

    if (payRail === PaymentRail.DEBIT_CARD) {
      const digits = (input.cardNumber || "").replace(/\D/g, "");
      if (digits.length < 12 || digits.length > 19) {
        throw new AppError("Valid card number required", 400, "CARD_REQUIRED");
      }
      if (!input.cardName?.trim()) {
        throw new AppError("Cardholder name required", 400, "CARD_REQUIRED");
      }
      if (!/^\d{2}\/\d{2}$/.test((input.cardExpiry || "").trim())) {
        throw new AppError("Card expiry must be MM/YY", 400, "CARD_REQUIRED");
      }
      if (!/^\d{3,4}$/.test((input.cardCvc || "").trim())) {
        throw new AppError("Card CVC required", 400, "CARD_REQUIRED");
      }
      last4 = digits.slice(-4);
      payNote = `DEBIT_CARD ·••${last4}`;
      // Full number + CVC discarded after validation — never persisted.
    } else if (payRail === PaymentRail.JAZZCASH || payRail === PaymentRail.EASYPAISA) {
      const phone = (input.walletPhone || "").replace(/\D/g, "");
      if (phone.length < 10 || phone.length > 13) {
        throw new AppError("Wallet mobile number required", 400, "WALLET_REQUIRED");
      }
      customerPhone = phone;
      payNote = `${payRail} · ${phone.slice(0, 4)}****${phone.slice(-3)}`;
    } else if (payRail === PaymentRail.GOOGLE_PAY || payRail === PaymentRail.PAYPAL) {
      const email = (input.accountEmail || "").trim().toLowerCase();
      if (!email.includes("@")) {
        throw new AppError("Payment account email required", 400, "ACCOUNT_REQUIRED");
      }
      customerEmail = email;
      payNote = `${payRail} · ${email.replace(/(.{2}).+(@.+)/, "$1***$2")}`;
    } else if (payRail === PaymentRail.CASH) {
      throw new AppError("Cash payments are not available", 400, "CASH_DISABLED");
    }

    const { gatewayService } = await import("../payments/gateway.service");
    const checkout = await gatewayService.startJobPayment({
      accountId: askerId,
      jobId,
      amount: job.quotation + job.visitFee,
      currency: job.currency,
      rail: payRail,
      payNote,
      customerEmail: customerEmail || job.asker.email,
      customerPhone: customerPhone || job.asker.phone || undefined,
      cardLast4: last4,
      returnUrl: input.returnUrl,
      cancelUrl: input.cancelUrl,
    });

    if (checkout.status !== "SUCCEEDED") {
      return {
        pending: true as const,
        mode: checkout.mode,
        status: checkout.status,
        transactionId: checkout.transactionId,
        checkoutUrl: checkout.checkoutUrl,
        clientSecret: checkout.clientSecret,
        provider: checkout.provider,
        rail: payRail,
        message: "Complete payment with the provider; job completes after webhook SUCCEEDED.",
      };
    }

    return this.applySuccessfulPayment(jobId, payRail, payNote);
  },

  /** Called after sandbox success or live webhook confirmation. */
  async applySuccessfulPayment(jobId: string, payRail: PaymentRail, payNote: string) {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { worker: true, asker: true },
    });
    if (!job) throw new AppError("Job not found", 404, "NOT_FOUND");
    if (job.status === JobStatus.COMPLETED) {
      const receipt = await prisma.paymentReceipt.findUnique({ where: { jobId } });
      return { job, receipt };
    }
    if (job.status !== JobStatus.ACCEPTED) {
      throw new AppError("Worker must accept before you can pay", 400, "INVALID_STATUS");
    }

    const result = await prisma.$transaction(async (tx) => {
      const completed = await tx.job.update({
        where: { id: jobId },
        data: {
          status: JobStatus.COMPLETED,
          rail: payRail,
          completedAt: new Date(),
        },
      });

      await tx.ledgerLine.createMany({
        data: [
          {
            accountId: job.workerId,
            jobId,
            kind: LedgerKind.QUOTATION,
            rail: payRail,
            amount: job.quotation,
            currency: job.currency,
            note: payNote,
          },
          {
            accountId: job.workerId,
            jobId,
            kind: LedgerKind.VISIT_FEE,
            rail: payRail,
            amount: job.visitFee,
            currency: job.currency,
            note: payNote,
          },
          {
            // Company passive income — no expert accountId
            jobId,
            kind: LedgerKind.COMMISSION,
            rail: payRail,
            amount: job.commission,
            currency: job.currency,
            note: `Company ${job.packageRate}% of job · ${payNote}`,
          },
          {
            accountId: job.workerId,
            jobId,
            kind: LedgerKind.NET_PAYOUT,
            rail: payRail,
            amount: job.netToWorker,
            currency: job.currency,
            note: `Expert net · ${payNote}`,
          },
          // Auto-release — desk does not gate payment (plan: transactions proceed without admin permission)
          {
            accountId: job.workerId,
            jobId,
            kind: LedgerKind.PAYOUT_RELEASE,
            rail: payRail,
            amount: job.netToWorker,
            currency: job.currency,
            note: `Auto-released on pay · ${payNote}`,
          },
        ],
      });

      await referrerService.creditFromCommission(
        job.workerId,
        jobId,
        job.commission,
        job.currency,
        tx,
      );

      const receiptNo = `CMTS-${new Date().getFullYear()}-${jobId.slice(-6).toUpperCase()}`;
      const receipt = await tx.paymentReceipt.create({
        data: {
          receiptNo,
          jobId,
          askerId: job.askerId,
          workerId: job.workerId,
          askerName: job.asker.name,
          workerName: job.worker.name,
          quotation: job.quotation,
          visitFee: job.visitFee,
          total: job.quotation + job.visitFee,
          packageRate: job.packageRate,
          commission: job.commission,
          netToWorker: job.netToWorker,
          currency: job.currency,
          rail: payRail,
          payNote,
          packageTier: job.worker.package,
        },
      });

      return { job: completed, receipt };
    });

    await prisma.notification.createMany({
      data: [
        {
          accountId: job.workerId,
          kind: "JOB",
          title: "Payment received",
          body: `${job.currency} ${job.netToWorker.toLocaleString()} net · receipt ${result.receipt.receiptNo}`,
          data: { jobId, receiptId: result.receipt.id },
        },
        {
          accountId: job.askerId,
          kind: "JOB",
          title: "Job completed · receipt ready",
          body: `Paid via ${payRail}. Receipt ${result.receipt.receiptNo}. Company kept ${job.currency} ${job.commission.toLocaleString()}.`,
          data: { jobId, receiptId: result.receipt.id },
        },
      ],
    });

    return result;
  },

  async getReceipt(accountId: string, receiptId: string, asDesk = false) {
    const receipt = await prisma.paymentReceipt.findUnique({ where: { id: receiptId } });
    if (!receipt) throw new AppError("Receipt not found", 404, "NOT_FOUND");
    if (
      !asDesk &&
      receipt.askerId !== accountId &&
      receipt.workerId !== accountId
    ) {
      throw new AppError("Receipt not found", 404, "NOT_FOUND");
    }
    return receipt;
  },

  async listReceipts(accountId: string, page = 1, pageSize = 10) {
    const where = { OR: [{ askerId: accountId }, { workerId: accountId }] };
    const [total, receipts] = await Promise.all([
      prisma.paymentReceipt.count({ where }),
      prisma.paymentReceipt.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, receipts };
  },

  async cancel(accountId: string, jobId: string) {
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job || (job.askerId !== accountId && job.workerId !== accountId)) {
      throw new AppError("Job not found", 404, "NOT_FOUND");
    }
    if (job.status === JobStatus.COMPLETED) {
      throw new AppError("Completed jobs cannot cancel", 400, "INVALID_STATUS");
    }
    return prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.CANCELLED },
    });
  },
};
