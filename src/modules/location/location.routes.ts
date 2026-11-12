import { Router } from "express";
import { requireAuth } from "../identity/identity.middleware";
import { locationController } from "./location.controller";

export const locationRouter = Router();

locationRouter.get("/me", requireAuth, locationController.mine);
locationRouter.patch("/me", requireAuth, locationController.save);
locationRouter.get("/nearby", requireAuth, locationController.nearby);
