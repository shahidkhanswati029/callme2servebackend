import { Router } from "express";
import { requireAuth } from "../identity/identity.middleware";
import { shopsController } from "./shops.controller";

export const shopsRouter = Router();

shopsRouter.get("/mine", requireAuth, shopsController.mine);
shopsRouter.post("/", requireAuth, shopsController.create);
shopsRouter.patch("/:id", requireAuth, shopsController.update);
shopsRouter.patch("/:id/pin", requireAuth, shopsController.pin);
shopsRouter.patch("/:id/door-photo", requireAuth, shopsController.doorPhoto);
shopsRouter.get("/nearby", requireAuth, shopsController.nearby);
