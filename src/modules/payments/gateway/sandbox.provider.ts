import { PaymentRail } from "@prisma/client";
import type { CheckoutInput, CheckoutResult, PaymentProvider, WebhookResult } from "./types";

/**
 * Local / pilot mode: no real money moves.
 * Marks checkout SUCCEEDED immediately so ledger + receipts still work in development.
 */
export const sandboxProvider: PaymentProvider = {
  name: "sandbox",

  supports(_rail: PaymentRail) {
    return true;
  },

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    return {
      provider: "sandbox",
      status: "SUCCEEDED",
      providerRef: `sandbox_${input.transactionId}`,
      raw: { mode: "sandbox", rail: input.rail },
    };
  },

  async parseWebhook(_headers, body: unknown): Promise<WebhookResult> {
    const b = (body || {}) as { providerRef?: string; status?: string };
    return {
      provider: "sandbox",
      providerRef: b.providerRef || "sandbox_unknown",
      status: b.status === "FAILED" ? "FAILED" : "SUCCEEDED",
      raw: body,
    };
  },
};
