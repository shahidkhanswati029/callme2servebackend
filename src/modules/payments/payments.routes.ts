import { Router } from "express";
import { PackageTier, PaymentRail } from "@prisma/client";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../identity/identity.middleware";
import { paymentsService } from "./payments.service";
import { gatewayService } from "./gateway.service";

export const paymentsRouter = Router();

paymentsRouter.get("/rates", (_req, res) => {
  res.json({ success: true, data: paymentsService.rates() });
});

/** How gateways are wired — sandbox vs live. */
paymentsRouter.get("/mode", (_req, res) => {
  res.json({ success: true, data: gatewayService.mode() });
});

paymentsRouter.get("/earnings", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const data = await paymentsService.earnings(req.auth!.sub);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

paymentsRouter.post("/payout-destination", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = z
      .object({
        rail: z.nativeEnum(PaymentRail),
        last4: z.string().length(4).optional(),
      })
      .parse(req.body);
    const account = await paymentsService.setPayoutDestination(req.auth!.sub, body);
    res.json({ success: true, message: "Payout destination saved", data: { account } });
  } catch (err) {
    next(err);
  }
});

paymentsRouter.post("/package", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = z
      .object({
        package: z.nativeEnum(PackageTier),
        rail: z.nativeEnum(PaymentRail),
        cardNumber: z.string().optional(),
        cardName: z.string().optional(),
        cardExpiry: z.string().optional(),
        cardCvc: z.string().optional(),
        returnUrl: z.string().url().optional(),
        cancelUrl: z.string().url().optional(),
      })
      .parse(req.body);
    const data = await paymentsService.payPackage(req.auth!.sub, body);
    const status = "status" in data ? String(data.status) : "SUCCEEDED";
    const pending = status !== "SUCCEEDED";
    res.json({
      success: true,
      message: pending
        ? "Payment started — complete checkout with the provider"
        : "Package paid",
      data,
    });
  } catch (err) {
    next(err);
  }
});

paymentsRouter.post("/payout-request", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = z.object({ amount: z.number().positive() }).parse(req.body);
    const line = await paymentsService.requestPayoutRelease(req.auth!.sub, body.amount);
    res.json({ success: true, message: "Payout released (no desk approval)", data: { line } });
  } catch (err) {
    next(err);
  }
});

/**
 * Provider webhooks (no user JWT).
 * Configure these URLs in each merchant dashboard after approval:
 *  - /api/payments/webhooks/jazzcash
 *  - /api/payments/webhooks/easypaisa
 *  - /api/payments/webhooks/stripe
 *  - /api/payments/webhooks/paypal
 *  - /api/payments/webhooks/sandbox  (local tests)
 */
paymentsRouter.post("/webhooks/:provider", async (req, res, next) => {
  try {
    const provider = String(req.params.provider || "").toLowerCase();
    const data = await gatewayService.handleWebhook(provider, req.headers as never, req.body);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});
