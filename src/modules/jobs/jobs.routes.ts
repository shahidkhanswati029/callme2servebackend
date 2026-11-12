import { Router } from "express";
import { PaymentRail } from "@prisma/client";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../identity/identity.middleware";
import { jobsService } from "./jobs.service";

export const jobsRouter = Router();

jobsRouter.get("/", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 10));
    const data = await jobsService.list(req.auth!.sub, page, pageSize);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

jobsRouter.post("/", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = z
      .object({
        workerId: z.string().min(1),
        quotation: z.number().positive(),
        visitFee: z.number().min(0),
        rail: z.nativeEnum(PaymentRail).refine((r) => r !== PaymentRail.CASH, {
          message: "Cash payments are not available",
        }),
      })
      .parse(req.body);
    const job = await jobsService.create(req.auth!.sub, body);
    res.status(201).json({ success: true, message: "Job ask sent", data: { job } });
  } catch (err) {
    next(err);
  }
});

jobsRouter.post("/:id/accept", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const job = await jobsService.accept(req.auth!.sub, String(req.params.id));
    res.json({ success: true, message: "Job accepted", data: { job } });
  } catch (err) {
    next(err);
  }
});

jobsRouter.post("/:id/complete", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = z
      .object({
        rail: z.nativeEnum(PaymentRail).refine((r) => r !== PaymentRail.CASH, {
          message: "Cash payments are not available",
        }),
        walletPhone: z.string().optional(),
        accountEmail: z.string().optional(),
        cardNumber: z.string().optional(),
        cardName: z.string().optional(),
        cardExpiry: z.string().optional(),
        cardCvc: z.string().optional(),
        returnUrl: z.string().url().optional(),
        cancelUrl: z.string().url().optional(),
      })
      .parse(req.body);
    const data = await jobsService.complete(req.auth!.sub, String(req.params.id), body);
    const pending = "pending" in data && data.pending;
    res.json({
      success: true,
      message: pending
        ? "Payment started — complete checkout with the provider"
        : "Job paid and completed — receipt generated",
      data,
    });
  } catch (err) {
    next(err);
  }
});

jobsRouter.get("/receipts", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 10));
    const data = await jobsService.listReceipts(req.auth!.sub, page, pageSize);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

jobsRouter.get("/receipts/:id", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const receipt = await jobsService.getReceipt(req.auth!.sub, String(req.params.id));
    res.json({ success: true, data: { receipt } });
  } catch (err) {
    next(err);
  }
});

jobsRouter.post("/:id/cancel", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const job = await jobsService.cancel(req.auth!.sub, String(req.params.id));
    res.json({ success: true, message: "Job cancelled", data: { job } });
  } catch (err) {
    next(err);
  }
});
