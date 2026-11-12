import { PaymentRail } from "@prisma/client";
import { env } from "../../../config/env";
import { AppError } from "../../../shared/errors/AppError";
import type { CheckoutInput, CheckoutResult, PaymentProvider, WebhookResult } from "./types";

/**
 * Easypaisa (Telenor Microfinance Bank) merchant checkout shape.
 * Apply via Easypaisa Merchant / partner onboarding, then set EASYPAISA_* env.
 */
export const easypaisaProvider: PaymentProvider = {
  name: "easypaisa",

  supports(rail) {
    return rail === PaymentRail.EASYPAISA;
  },

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    if (!env.EASYPAISA_STORE_ID || !env.EASYPAISA_HASH_KEY) {
      throw new AppError(
        "Easypaisa is not configured. Add EASYPAISA_STORE_ID / HASH_KEY after merchant approval.",
        503,
        "GATEWAY_NOT_CONFIGURED",
      );
    }

    const providerRef = `EP_${input.transactionId}`;
    const checkoutUrl = `${env.EASYPAISA_CHECKOUT_URL}?orderId=${encodeURIComponent(providerRef)}`;

    return {
      provider: "easypaisa",
      status: "REQUIRES_ACTION",
      providerRef,
      checkoutUrl,
      raw: {
        note: "Replace with Easypaisa encrypted request + redirect after store credentials are live.",
        amount: input.amount,
        currency: input.currency,
      },
    };
  },

  async parseWebhook(_headers, body: unknown): Promise<WebhookResult> {
    const b = (body || {}) as {
      orderId?: string;
      transactionStatus?: string;
      amount?: string | number;
      currency?: string;
      message?: string;
    };
    const ok = String(b.transactionStatus || "").toUpperCase() === "PAID";
    return {
      provider: "easypaisa",
      providerRef: b.orderId || "",
      status: ok ? "SUCCEEDED" : "FAILED",
      amount: b.amount != null ? Number(b.amount) : undefined,
      currency: b.currency,
      failureReason: ok ? undefined : b.message,
      raw: body,
    };
  },
};
