import { Router } from "express";
import { identityController } from "./identity.controller";
import { requireAuth } from "./identity.middleware";

export const identityRouter = Router();

identityRouter.post("/register", identityController.register);
identityRouter.post("/login", identityController.login);
identityRouter.post("/desk/login", identityController.deskLogin);
identityRouter.post("/refresh", identityController.refresh);
identityRouter.post("/google", identityController.google);
identityRouter.post("/facebook", identityController.facebook);

identityRouter.post("/webauthn/login/options", identityController.webauthnLoginOptions);
identityRouter.post("/webauthn/login/verify", identityController.webauthnLoginVerify);

identityRouter.post("/logout", requireAuth, identityController.logout);
identityRouter.get("/me", requireAuth, identityController.me);
identityRouter.patch("/details", requireAuth, identityController.saveDetails);
identityRouter.patch("/photo", requireAuth, identityController.savePhoto);
identityRouter.patch("/biometrics", requireAuth, identityController.enrollBiometrics);

identityRouter.post(
  "/webauthn/register/options",
  requireAuth,
  identityController.webauthnRegisterOptions,
);
identityRouter.post(
  "/webauthn/register/verify",
  requireAuth,
  identityController.webauthnRegisterVerify,
);
