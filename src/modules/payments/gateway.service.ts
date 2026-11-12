import {
  LedgerKind,
  PackageTier,
  PaymentPurpose,
  PaymentRail,
  PaymentStatus,
  Seat,
} from "@prisma/client";
import { prisma } from "../../shared/db/prisma";
import { AppError } from "../../shared/errors/AppError";
import { toPublicAccount } from "../identity/identity.types";
import { paymentsMode, providerByName, providerForRail } from "./gateway";

const PACKAGE_PRICE_PKR: Record<PackageTier, number> = {
  FREE: 0,
  SILVER: 1500,
  GOLD: 3500,
  PLATINUM: 6000,
};

function mapStatus(s: string): PaymentStatus {
  if (s === "SUCCEEDED") return PaymentStatus.SUCCEEDED;
  if (s === "FAILED") return PaymentStatus.FAILED;
  if (s === "CANCELLED") return PaymentStatus.CANCELLED;
  if (s === "REQUIRES_ACTION") return PaymentStatus.REQUIRES_ACTION;
  return PaymentStatus.PENDING;
}

async function finalizePackage(txId: string) {
  const tx = await prisma.paymentTransaction.findUnique({ where: { id: txId } });
  if (!tx || tx.purpose !== PaymentPurpose.PACKAGE) return null;
  if (tx.status === PaymentStatus.SUCCEEDED && tx.paidAt) {
    const account = await prisma.account.findUnique({ where: { id: tx.accountId } });
    return account;
  }

  const tier = (tx.packageTier || "FREE") as PackageTier;
  const updated = await prisma.$transaction(async (db) => {
    const account = await db.account.update({
      where: { id: tx.accountId },
      data: { package: tier },
    });
    await db.ledgerLine.create({
      data: {
        accountId: tx.accountId,
        kind: LedgerKind.PACKAGE_FEE,
        rail: tx.rail,
        amount: tx.amount,
        currency: tx.currency,
        note: `${tier} month · ${tx.rail} · ${tx.provider}:${tx.providerRef || tx.id}`,
      },
    });
    await db.paymentTransaction.update({
      where: { id: tx.id },
      data: { status: PaymentStatus.SUCCEEDED, paidAt: new Date() },
    });
    await db.notification.create({
      data: {
        accountId: tx.accountId,
        kind: "SYSTEM",
        title: "Package payment confirmed",
        body: `${tier} · ${tx.currency} ${tx.amount.toLocaleString()} via ${tx.rail}`,
        data: { payment: true, package: tier, transactionId: tx.id, rail: tx.rail },
      },
    });
    return account;
  });
  return updated;
}

export const gatewayService = {
  mode() {
    return {
      mode: paymentsMode(),
      rails: {
        JAZZCASH: "JazzCash merchant hosted checkout",
        EASYPAISA: "Easypaisa merchant checkout",
        DEBIT_CARD: "Stripe PaymentIntent / Elements",
        GOOGLE_PAY: "Stripe + Google Pay wallet",
        PAYPAL: "PayPal Orders v2",
      },
      note:
        paymentsMode() === "sandbox"
          ? "Sandbox: no real money. Set PAYMENTS_MODE=live and provider keys for production."
          : "Live mode: providers must be configured; money moves only after webhook SUCCEEDED.",
    };
  },

  /**
   * Start a package payment.
   * sandbox → succeeds immediately and upgrades package.
   * live → returns checkoutUrl/clientSecret; webhook finalizes.
   */
  async startPackagePayment(
    accountId: string,
    input: {
      package: PackageTier;
      rail: PaymentRail;
      cardNumber?: string;
      returnUrl?: string;
      cancelUrl?: string;
    },
  ) {
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.seat !== Seat.EXPERT) {
      throw new AppError("Expert only", 403, "WRONG_SEAT");
    }
    if (input.rail === PaymentRail.CASH) {
      throw new AppError("Cash payments are not available", 400, "CASH_DISABLED");
    }

    const amount = PACKAGE_PRICE_PKR[input.package];
    if (amount <= 0) {
      const updated = await prisma.account.update({
        where: { id: accountId },
        data: { package: PackageTier.FREE },
      });
      return {
        mode: paymentsMode(),
        status: "SUCCEEDED" as const,
        account: toPublicAccount(updated),
        paid: 0,
        currency: account.currency,
        rail: input.rail,
      };
    }

    // Live card: never accept raw PAN — frontend must use Stripe Elements.
    if (
      paymentsMode() === "live" &&
      input.rail === PaymentRail.DEBIT_CARD &&
      input.cardNumber
    ) {
      throw new AppError(
        "In live mode, do not send card numbers to this API. Use Stripe Payment Element / client_secret.",
        400,
        "RAW_CARD_FORBIDDEN",
      );
    }

    const draft = await prisma.paymentTransaction.create({
      data: {
        accountId,
        purpose: PaymentPurpose.PACKAGE,
        rail: input.rail,
        provider: "pending",
        status: PaymentStatus.PENDING,
        amount,
        currency: account.currency,
        packageTier: input.package,
        metadata: {
          returnUrl: input.returnUrl || "",
          cancelUrl: input.cancelUrl || "",
        },
      },
    });

    const provider = providerForRail(input.rail);
    const checkout = await provider.createCheckout({
      transactionId: draft.id,
      amount,
      currency: account.currency,
      rail: input.rail,
      purpose: "PACKAGE",
      description: `CallMe2Serve ${input.package} package`,
      customerEmail: account.email,
      customerPhone: account.phone || undefined,
      cardLast4: input.cardNumber ? input.cardNumber.replace(/\D/g, "").slice(-4) : undefined,
      returnUrl: input.returnUrl,
      cancelUrl: input.cancelUrl,
      metadata: { purpose: "PACKAGE", package: input.package },
    });

    const updatedTx = await prisma.paymentTransaction.update({
      where: { id: draft.id },
      data: {
        provider: checkout.provider,
        providerRef: checkout.providerRef,
        checkoutUrl: checkout.checkoutUrl || null,
        clientSecret: checkout.clientSecret || null,
        status: mapStatus(checkout.status),
        paidAt: checkout.status === "SUCCEEDED" ? new Date() : null,
      },
    });

    if (checkout.status === "SUCCEEDED") {
      const accountAfter = await finalizePackage(updatedTx.id);
      return {
        mode: paymentsMode(),
        status: "SUCCEEDED" as const,
        transactionId: updatedTx.id,
        account: toPublicAccount(accountAfter!),
        paid: amount,
        currency: account.currency,
        rail: input.rail,
        provider: checkout.provider,
      };
    }

    return {
      mode: paymentsMode(),
      status: checkout.status,
      transactionId: updatedTx.id,
      provider: checkout.provider,
      checkoutUrl: checkout.checkoutUrl,
      clientSecret: checkout.clientSecret,
      paid: amount,
      currency: account.currency,
      rail: input.rail,
      message: "Complete payment with the provider, then webhook will confirm.",
    };
  },

  async handleWebhook(providerName: string, headers: Record<string, string | string[] | undefined>, body: unknown) {
    const provider = providerByName(providerName) || providerByName("sandbox");
    if (!provider) throw new AppError("Unknown payment provider", 400, "UNKNOWN_PROVIDER");

    const parsed = await provider.parseWebhook(headers, body);
    if (!parsed.providerRef) {
      throw new AppError("Webhook missing provider reference", 400, "INVALID_WEBHOOK");
    }

    const tx = await prisma.paymentTransaction.findFirst({
      where: { providerRef: parsed.providerRef },
    });
    if (!tx) {
      throw new AppError("Payment transaction not found for webhook", 404, "TX_NOT_FOUND");
    }

    if (parsed.status === "FAILED" || parsed.status === "CANCELLED") {
      await prisma.paymentTransaction.update({
        where: { id: tx.id },
        data: {
          status: parsed.status === "CANCELLED" ? PaymentStatus.CANCELLED : PaymentStatus.FAILED,
          failureReason: parsed.failureReason || null,
        },
      });
      return { ok: true, transactionId: tx.id, status: parsed.status };
    }

    if (parsed.status !== "SUCCEEDED") {
      return { ok: true, transactionId: tx.id, status: parsed.status };
    }

    if (tx.purpose === PaymentPurpose.PACKAGE) {
      await finalizePackage(tx.id);
    } else if (tx.purpose === PaymentPurpose.JOB && tx.jobId) {
      const meta = (tx.metadata || {}) as { payNote?: string };
      const { jobsService } = await import("../jobs/jobs.service");
      await jobsService.applySuccessfulPayment(tx.jobId, tx.rail, meta.payNote || String(tx.rail));
      await prisma.paymentTransaction.update({
        where: { id: tx.id },
        data: { status: PaymentStatus.SUCCEEDED, paidAt: new Date() },
      });
    } else {
      await prisma.paymentTransaction.update({
        where: { id: tx.id },
        data: { status: PaymentStatus.SUCCEEDED, paidAt: new Date() },
      });
    }

    return { ok: true, transactionId: tx.id, status: "SUCCEEDED" };
  },

  /**
   * Job payment checkout. Sandbox succeeds immediately; live returns checkoutUrl/clientSecret.
   */
  async startJobPayment(input: {
    accountId: string;
    jobId: string;
    amount: number;
    currency: string;
    rail: PaymentRail;
    payNote: string;
    customerEmail?: string;
    customerPhone?: string;
    cardLast4?: string;
    returnUrl?: string;
    cancelUrl?: string;
  }) {
    if (input.rail === PaymentRail.CASH) {
      throw new AppError("Cash payments are not available", 400, "CASH_DISABLED");
    }
    const draft = await prisma.paymentTransaction.create({
      data: {
        accountId: input.accountId,
        jobId: input.jobId,
        purpose: PaymentPurpose.JOB,
        rail: input.rail,
        provider: "pending",
        status: PaymentStatus.PENDING,
        amount: input.amount,
        currency: input.currency,
        metadata: { payNote: input.payNote },
      },
    });

    const provider = providerForRail(input.rail);
    const checkout = await provider.createCheckout({
      transactionId: draft.id,
      amount: input.amount,
      currency: input.currency,
      rail: input.rail,
      purpose: "JOB",
      description: `CallMe2Serve job ${input.jobId}`,
      customerEmail: input.customerEmail,
      customerPhone: input.customerPhone,
      cardLast4: input.cardLast4,
      returnUrl: input.returnUrl,
      cancelUrl: input.cancelUrl,
      metadata: { purpose: "JOB", jobId: input.jobId },
    });

    const updatedTx = await prisma.paymentTransaction.update({
      where: { id: draft.id },
      data: {
        provider: checkout.provider,
        providerRef: checkout.providerRef,
        checkoutUrl: checkout.checkoutUrl || null,
        clientSecret: checkout.clientSecret || null,
        status: mapStatus(checkout.status),
        paidAt: checkout.status === "SUCCEEDED" ? new Date() : null,
      },
    });

    return {
      mode: paymentsMode(),
      status: checkout.status,
      transactionId: updatedTx.id,
      provider: checkout.provider,
      checkoutUrl: checkout.checkoutUrl,
      clientSecret: checkout.clientSecret,
      paid: input.amount,
      currency: input.currency,
      rail: input.rail,
    };
  },
};
