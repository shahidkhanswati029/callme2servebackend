import { PaymentRail } from "@prisma/client";
import { env } from "../../../config/env";
import { AppError } from "../../../shared/errors/AppError";
import type { CheckoutInput, CheckoutResult, PaymentProvider, WebhookResult } from "./types";

/**
 * Stripe for DEBIT_CARD + GOOGLE_PAY (Payment Element / Google Pay wallet).
 * Apply: https://dashboard.stripe.com → Activate account → API keys + webhooks.
 * Never send raw PAN to your server in live mode — use Stripe.js / Payment Element.
 */
export const stripeProvider: PaymentProvider = {
  name: "stripe",

  supports(rail) {
    return rail === PaymentRail.DEBIT_CARD || rail === PaymentRail.GOOGLE_PAY;
  },

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    if (!env.STRIPE_SECRET_KEY) {
      throw new AppError(
        "Stripe is not configured. Add STRIPE_SECRET_KEY after Stripe account activation.",
        503,
        "GATEWAY_NOT_CONFIGURED",
      );
    }

    // Theoretical live call with stripe SDK:
    // const intent = await stripe.paymentIntents.create({
    //   amount: Math.round(input.amount * 100),
    //   currency: input.currency.toLowerCase(),
    //   automatic_payment_methods: { enabled: true },
    //   metadata: { transactionId: input.transactionId, ...input.metadata },
    // });
    const providerRef = `pi_pending_${input.transactionId}`;
    return {
      provider: "stripe",
      status: "REQUIRES_ACTION",
      providerRef,
      clientSecret: `pending_secret_${input.transactionId}`,
      checkoutUrl: input.returnUrl,
      raw: {
        note: "Install stripe SDK and create a real PaymentIntent; return client_secret to the frontend.",
        amount: input.amount,
        currency: input.currency,
        rail: input.rail,
      },
    };
  },

  async parseWebhook(headers, body: unknown): Promise<WebhookResult> {
    if (!env.STRIPE_WEBHOOK_SECRET) {
      throw new AppError("STRIPE_WEBHOOK_SECRET missing", 503, "GATEWAY_NOT_CONFIGURED");
    }
    // Theoretical: stripe.webhooks.constructEvent(rawBody, sig, secret)
    const b = (body || {}) as {
      type?: string;
      data?: { object?: { id?: string; amount_received?: number; currency?: string; last_payment_error?: { message?: string } } };
    };
    const obj = b.data?.object || {};
    if (b.type === "payment_intent.succeeded") {
      return {
        provider: "stripe",
        providerRef: obj.id || "",
        status: "SUCCEEDED",
        amount: obj.amount_received != null ? obj.amount_received / 100 : undefined,
        currency: obj.currency?.toUpperCase(),
        raw: body,
      };
    }
    if (b.type === "payment_intent.payment_failed") {
      return {
        provider: "stripe",
        providerRef: obj.id || "",
        status: "FAILED",
        failureReason: obj.last_payment_error?.message,
        raw: body,
      };
    }
    return {
      provider: "stripe",
      providerRef: obj.id || "",
      status: "PENDING",
      raw: body,
    };
  },
};
