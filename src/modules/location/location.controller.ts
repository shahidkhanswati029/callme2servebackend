import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../identity/identity.middleware";
import { locationService } from "./location.service";
import { nearbyQuerySchema, savePlaceSchema } from "./location.validation";

export const locationController = {
  async mine(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const data = await locationService.getMine(req.auth!.sub);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async save(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const body = savePlaceSchema.parse(req.body);
      const data = await locationService.savePlace(req.auth!.sub, body);
      res.json({ success: true, message: data.message, data });
    } catch (err) {
      next(err);
    }
  },

  async nearby(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const q = nearbyQuerySchema.parse(req.query);
      const experts = await locationService.nearby(req.auth!.sub, q.km, {
        category: q.category,
        q: q.q,
      });
      res.json({ success: true, data: { experts, km: q.km } });
    } catch (err) {
      next(err);
    }
  },
};
