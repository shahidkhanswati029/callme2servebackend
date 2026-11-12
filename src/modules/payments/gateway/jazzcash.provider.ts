import { PaymentRail } from "@prisma/client";
import { env } from "../../../config/env";
import { AppError } from "../../../shared/errors/AppError";
import type { CheckoutInput, CheckoutResult, PaymentProvider, WebhookResult } from "./types";

/**
 * JazzCash production shape (hosted checkout).
 * Fill JAZZCASH_* env after merchant approval, then set PAYMENTS_MODE=live.
 *
 * Apply: https://sandbox.jazzcash.com.pk / JazzCash Merchant portal
 * Docs typically need: MerchantID, Password, IntegritySalt, ReturnURL
 */
export const jazzcashProvider: PaymentProvider = {
  name: "jazzcash",

  supports(rail) {
    return rail === PaymentRail.JAZZCASH;
  },

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    if (!env.JAZZCASH_MERCHANT_ID || !env.JAZZCASH_PASSWORD || !env.JAZZCASH_INTEGRITY_SALT) {
      throw new AppError(
        "JazzCash is not configured. Add JAZZCASH_MERCHANT_ID / PASSWORD / INTEGRITY_SALT after merchant approval.",
        503,
        "GATEWAY_NOT_CONFIGURED",
      );
    }

    // Theoretical production call:
    // 1) Build signed payload with amount (paisa), txn ref, return URL
    // 2) POST/redirect to JazzCash Hosted Checkout
    // 3) Wait for IPN/webhook before marking SUCCEEDED
    const providerRef = `JC_${input.transactionId}`;
    const checkoutUrl = `${env.JAZZCASH_CHECKOUT_URL}?txn=${encodeURIComponent(providerRef)}`;

    return {
      provider: "jazzcash",
      status: "REQUIRES_ACTION",
      providerRef,
      checkoutUrl,
      raw: {
        note: "Replace with signed JazzCash hosted-checkout form fields after merchant credentials are live.",
        amount: input.amount,
        currency: input.currency,
        phone: input.customerPhone,
      },
    };
  },

  async parseWebhook(_headers, body: unknown): Promise<WebhookResult> {
    const b = (body || {}) as {
      pp_TxnRefNo?: string;
      pp_ResponseCode?: string;
      pp_Amount?: string;
      pp_TxnCurrency?: string;
      pp_ResponseMessage?: string;
    };
    const ok = b.pp_ResponseCode === "000";
    return {
      provider: "jazzcash",
      providerRef: b.pp_TxnRefNo || "",
      status: ok ? "SUCCEEDED" : "FAILED",
      amount: b.pp_Amount ? Number(b.pp_Amount) / 100 : undefined,
      currency: b.pp_TxnCurrency,
      failureReason: ok ? undefined : b.pp_ResponseMessage,
      raw: body,
    };
  },
};
