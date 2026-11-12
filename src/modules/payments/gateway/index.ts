import { PaymentRail } from "@prisma/client";
import { env } from "../../../config/env";
import { AppError } from "../../../shared/errors/AppError";
import { sandboxProvider } from "./sandbox.provider";
import { jazzcashProvider } from "./jazzcash.provider";
import { easypaisaProvider } from "./easypaisa.provider";
import { stripeProvider } from "./stripe.provider";
import { paypalProvider } from "./paypal.provider";
import type { PaymentProvider } from "./types";

const liveProviders: PaymentProvider[] = [
  jazzcashProvider,
  easypaisaProvider,
  stripeProvider,
  paypalProvider,
];

export function paymentsMode(): "sandbox" | "live" {
  return env.PAYMENTS_MODE === "live" ? "live" : "sandbox";
}

export function providerForRail(rail: PaymentRail): PaymentProvider {
  if (rail === PaymentRail.CASH) {
    throw new AppError("Cash payments are not available", 400, "CASH_DISABLED");
  }
  if (paymentsMode() === "sandbox") return sandboxProvider;

  const match = liveProviders.find((p) => p.supports(rail));
  if (!match) {
    throw new AppError(`No live provider registered for ${rail}`, 400, "RAIL_UNSUPPORTED");
  }
  return match;
}

export function providerByName(name: string): PaymentProvider | undefined {
  if (name === "sandbox") return sandboxProvider;
  return liveProviders.find((p) => p.name === name);
}

export * from "./types";
