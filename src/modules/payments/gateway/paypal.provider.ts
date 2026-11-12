import { PaymentRail } from "@prisma/client";
import { env } from "../../../config/env";
import { AppError } from "../../../shared/errors/AppError";
import type { CheckoutInput, CheckoutResult, PaymentProvider, WebhookResult } from "./types";

/**
 * PayPal Checkout (Orders v2).
 * Apply: https://developer.paypal.com → Apps & Credentials (Sandbox then Live).
 */
export const paypalProvider: PaymentProvider = {
  name: "paypal",

  supports(rail) {
    return rail === PaymentRail.PAYPAL;
  },

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
      throw new AppError(
        "PayPal is not configured. Add PAYPAL_CLIENT_ID / CLIENT_SECRET after app credentials are created.",
        503,
        "GATEWAY_NOT_CONFIGURED",
      );
    }

    const providerRef = `PP_${input.transactionId}`;
    const checkoutUrl = `${env.PAYPAL_CHECKOUT_BASE}/checkoutnow?token=${encodeURIComponent(providerRef)}`;

    return {
      provider: "paypal",
      status: "REQUIRES_ACTION",
      providerRef,
      checkoutUrl,
      raw: {
        note: "Create PayPal Order via REST, return approve link; capture on webhook/return.",
        amount: input.amount,
        currency: input.currency,
      },
    };
  },

  async parseWebhook(_headers, body: unknown): Promise<WebhookResult> {
    const b = (body || {}) as {
      event_type?: string;
      resource?: { id?: string; status?: string; amount?: { value?: string; currency_code?: string } };
    };
    const succeeded =
      b.event_type === "PAYMENT.CAPTURE.COMPLETED" ||
      b.resource?.status === "COMPLETED";
    return {
      provider: "paypal",
      providerRef: b.resource?.id || "",
      status: succeeded ? "SUCCEEDED" : "FAILED",
      amount: b.resource?.amount?.value ? Number(b.resource.amount.value) : undefined,
      currency: b.resource?.amount?.currency_code,
      raw: body,
    };
  },
};
