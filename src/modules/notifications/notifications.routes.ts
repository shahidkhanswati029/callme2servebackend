import { Router } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../identity/identity.middleware";
import { notificationsService } from "./notifications.service";

export const notificationsRouter = Router();

notificationsRouter.get("/", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 20));
    const data = await notificationsService.list(req.auth!.sub, page, pageSize);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.post("/read-all", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    await notificationsService.markAllRead(req.auth!.sub);
    res.json({ success: true, message: "All notifications marked read" });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.post("/:id/read", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    await notificationsService.markRead(req.auth!.sub, String(req.params.id));
    res.json({ success: true, message: "Notification read" });
  } catch (err) {
    next(err);
  }
});

notificationsRouter.post("/push-token", requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = z
      .object({ token: z.string().min(10), language: z.string().default("en") })
      .parse(req.body);
    await notificationsService.savePushToken(req.auth!.sub, body.token, body.language);
    res.json({ success: true, message: "Push token saved" });
  } catch (err) {
    next(err);
  }
});
