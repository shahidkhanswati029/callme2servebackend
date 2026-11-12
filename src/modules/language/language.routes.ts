import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../identity/identity.middleware";
import { prisma } from "../../shared/db/prisma";
import { toPublicAccount } from "../identity/identity.types";

export const languageRouter = Router();

const uiLanguages = ["en", "ur", "pa", "ar", "fa", "ja"] as const;

languageRouter.patch("/", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = z
      .object({
        uiLanguage: z.enum(uiLanguages).optional(),
        languages: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
        country: z.string().trim().min(2).max(8).optional(),
        currency: z.string().trim().min(3).max(8).optional(),
      })
      .parse(req.body);

    const account = await prisma.account.update({
      where: { id: req.auth!.sub },
      data: {
        ...(body.uiLanguage ? { uiLanguage: body.uiLanguage } : {}),
        ...(body.languages ? { languages: body.languages } : {}),
        ...(body.country ? { country: body.country.toUpperCase() } : {}),
        ...(body.currency ? { currency: body.currency.toUpperCase() } : {}),
      },
    });

    res.json({
      success: true,
      message: "Preferences saved",
      data: { account: toPublicAccount(account) },
    });
  } catch (err) {
    next(err);
  }
});
