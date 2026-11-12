import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../identity/identity.middleware";
import { referrerService } from "./referrer.service";
import { toPublicAccount } from "../identity/identity.types";
import { prisma } from "../../shared/db/prisma";

export const referrerRouter = Router();

referrerRouter.get("/me", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const data = await referrerService.mine(req.auth!.sub);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

referrerRouter.post("/attach", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = z.object({ code: z.string().trim().min(4).max(24) }).parse(req.body);
    const account = await prisma.account.findUnique({ where: { id: req.auth!.sub } });
    if (account?.referredById) {
      res.json({
        success: true,
        message: "Referrer already set",
        data: { account: toPublicAccount(account) },
      });
      return;
    }
    await referrerService.attachOnSignup(req.auth!.sub, body.code);
    const updated = await prisma.account.findUniqueOrThrow({ where: { id: req.auth!.sub } });
    res.json({
      success: true,
      message: "Referrer linked",
      data: { account: toPublicAccount(updated) },
    });
  } catch (err) {
    next(err);
  }
});
