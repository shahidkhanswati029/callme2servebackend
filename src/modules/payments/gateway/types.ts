import type { PaymentRail } from "@prisma/client";

export type CheckoutInput = {
  transactionId: string;
  amount: number;
  currency: string;
  rail: PaymentRail;
  purpose: "PACKAGE" | "JOB" | "PAYOUT";
  description: string;
  customerEmail?: string;
  customerPhone?: string;
  /** Never log/store raw card beyond last4 — only for sandbox demo or Stripe Elements token later */
  cardLast4?: string;
  returnUrl?: string;
  cancelUrl?: string;
  metadata?: Record<string, string>;
};

export type CheckoutResult = {
  provider: string;
  status: "PENDING" | "REQUIRES_ACTION" | "SUCCEEDED" | "FAILED";
  providerRef: string;
  checkoutUrl?: string;
  clientSecret?: string;
  raw?: unknown;
};

export type WebhookResult = {
  provider: string;
  providerRef: string;
  status: "SUCCEEDED" | "FAILED" | "CANCELLED" | "PENDING";
  amount?: number;
  currency?: string;
  failureReason?: string;
  raw?: unknown;
};

export interface PaymentProvider {
  readonly name: string;
  supports(rail: PaymentRail): boolean;
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  parseWebhook(headers: Record<string, string | string[] | undefined>, body: unknown): Promise<WebhookResult>;
}
