import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "../identity/identity.middleware";
import { shopsService } from "./shops.service";
import {
  createShopSchema,
  doorPhotoSchema,
  shopPinSchema,
  updateShopSchema,
} from "./shops.validation";
import { nearbyQuerySchema } from "../location/location.validation";

export const shopsController = {
  async mine(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const shops = await shopsService.listMine(req.auth!.sub);
      res.json({ success: true, data: { shops } });
    } catch (err) {
      next(err);
    }
  },

  async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const body = createShopSchema.parse(req.body);
      const shop = await shopsService.create(req.auth!.sub, body);
      res.status(201).json({
        success: true,
        message: "Shop created. Add live pin and door photo to publish.",
        data: { shop },
      });
    } catch (err) {
      next(err);
    }
  },

  async update(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const body = updateShopSchema.parse(req.body);
      const id = String(req.params.id);
      const shop = await shopsService.update(req.auth!.sub, id, body);
      res.json({ success: true, message: "Shop updated", data: { shop } });
    } catch (err) {
      next(err);
    }
  },

  async pin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const body = shopPinSchema.parse(req.body);
      const id = String(req.params.id);
      const shop = await shopsService.savePin(req.auth!.sub, id, body);
      res.json({
        success: true,
        message:
          shop.status === "LIVE"
            ? "Shop is live on the map"
            : `Shop held: ${shop.heldReason}`,
        data: { shop },
      });
    } catch (err) {
      next(err);
    }
  },

  async doorPhoto(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const body = doorPhotoSchema.parse(req.body);
      const id = String(req.params.id);
      const shop = await shopsService.setDoorPhoto(
        req.auth!.sub,
        id,
        body.doorPhotoUrl,
      );
      res.json({
        success: true,
        message:
          shop.status === "LIVE"
            ? "Door photo saved. Shop is live."
            : `Door photo saved. Still held: ${shop.heldReason}`,
        data: { shop },
      });
    } catch (err) {
      next(err);
    }
  },

  async nearby(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const q = nearbyQuerySchema.parse(req.query);
      const shops = await shopsService.nearbyLive(req.auth!.sub, q.km);
      res.json({ success: true, data: { shops, km: q.km } });
    } catch (err) {
      next(err);
    }
  },
};
