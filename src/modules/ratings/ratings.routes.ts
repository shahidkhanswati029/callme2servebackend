import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../identity/identity.middleware";
import { ratingsService } from "./ratings.service";

export const ratingsRouter = Router();

const upsertSchema = z.object({
  toAccountId: z.string().min(1),
  stars: z.number().int().min(1).max(5),
  text: z.string().max(500).optional(),
  jobId: z.string().optional(),
});

ratingsRouter.get(
  "/:expertId",
  requireAuth,
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const data = await ratingsService.getForExpert(
        req.auth!.sub,
        String(req.params.expertId),
      );
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },
);

ratingsRouter.post("/", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = upsertSchema.parse(req.body);
    const data = await ratingsService.upsert(req.auth!.sub, body);
    res.status(201).json({
      success: true,
      message: "Rating saved",
      data,
    });
  } catch (err) {
    next(err);
  }
});
