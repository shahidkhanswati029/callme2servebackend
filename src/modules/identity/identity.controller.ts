import type { NextFunction, Request, Response } from "express";
import { Seat } from "@prisma/client";
import { z } from "zod";
import { clearAuthCookies, setAuthCookies } from "../../shared/utils/cookies";
import { identityService } from "./identity.service";
import type { AuthenticatedRequest } from "./identity.middleware";
import {
  deskLoginSchema,
  detailsSchema,
  enrollBiometricsSchema,
  facebookSchema,
  googleSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  webauthnAuthSchema,
  webauthnDeviceSchema,
} from "./identity.validation";
import { webauthnService } from "./webauthn.service";
import type { AuthResult } from "./identity.types";

function sendAuth(res: Response, status: number, result: AuthResult, message?: string) {
  setAuthCookies(res, result.tokens);
  // Also return tokens in JSON so the SPA can persist them in localStorage
  // (cross-origin localhost:3000 → :4000 cannot rely on httpOnly cookies alone).
  // Frontend must NOT write these into document.cookie.
  res.status(status).json({
    success: true,
    message: message || "Signed in",
    data: {
      account: result.account,
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
    },
  });
}

function refreshFromRequest(req: Request): string | undefined {
  const bodyToken = (req.body as { refreshToken?: string })?.refreshToken;
  if (bodyToken) return bodyToken;
  return req.cookies?.cmts_refresh as string | undefined;
}

export const identityController = {
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      const body = registerSchema.parse(req.body);
      const result = await identityService.registerExpert(body);
      sendAuth(res, 201, result, "Expert account created");
    } catch (err) {
      next(err);
    }
  },

  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const body = loginSchema.parse(req.body);
      const result = await identityService.loginWithPassword(
        body.email,
        body.password,
        Seat.EXPERT,
      );
      sendAuth(res, 200, result, "Welcome back");
    } catch (err) {
      next(err);
    }
  },

  async deskLogin(req: Request, res: Response, next: NextFunction) {
    try {
      const body = deskLoginSchema.parse(req.body);
      const result = await identityService.deskLoginByEmail(body.email);
      sendAuth(res, 200, result, "Desk signed in");
    } catch (err) {
      next(err);
    }
  },

  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const token = refreshFromRequest(req);
      if (!token) {
        refreshSchema.parse({ refreshToken: "" });
      }
      const result = await identityService.refresh(token!);
      sendAuth(res, 200, result, "Session restored");
    } catch (err) {
      next(err);
    }
  },

  async logout(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      if (req.auth?.sub) await identityService.logout(req.auth.sub);
      clearAuthCookies(res);
      res.json({ success: true, message: "Signed out", data: { loggedOut: true } });
    } catch (err) {
      next(err);
    }
  },

  async me(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const account = await identityService.me(req.auth!.sub);
      res.json({ success: true, data: { account } });
    } catch (err) {
      next(err);
    }
  },

  async google(req: Request, res: Response, next: NextFunction) {
    try {
      const body = googleSchema.parse(req.body);
      const result = await identityService.loginWithGoogle(body);
      sendAuth(res, 200, result, "Google sign-in successful");
    } catch (err) {
      next(err);
    }
  },

  async facebook(req: Request, res: Response, next: NextFunction) {
    try {
      const body = facebookSchema.parse(req.body);
      const result = await identityService.loginWithFacebook(body);
      sendAuth(res, 200, result, "Facebook sign-in successful");
    } catch (err) {
      next(err);
    }
  },

  async enrollBiometrics(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const body = enrollBiometricsSchema.parse(req.body);
      const account = await identityService.enrollBiometrics(req.auth!.sub, body);
      res.json({
        success: true,
        message: "Biometric flags updated",
        data: { account },
      });
    } catch (err) {
      next(err);
    }
  },

  async saveDetails(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const body = detailsSchema.parse(req.body);
      const account = await identityService.saveDetails(req.auth!.sub, body);
      res.json({
        success: true,
        message: "Details saved",
        data: { account },
      });
    } catch (err) {
      next(err);
    }
  },

  async savePhoto(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const body = z.object({ photoUrl: z.string().url() }).parse(req.body);
      const account = await identityService.savePhoto(req.auth!.sub, body.photoUrl);
      res.json({
        success: true,
        message: "Photo saved",
        data: { account },
      });
    } catch (err) {
      next(err);
    }
  },

  async webauthnRegisterOptions(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const options = await webauthnService.registrationOptions(req.auth!.sub);
      res.json({ success: true, data: { options } });
    } catch (err) {
      next(err);
    }
  },

  async webauthnRegisterVerify(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const body = webauthnDeviceSchema.parse(req.body);
      const account = await webauthnService.verifyRegistration(
        req.auth!.sub,
        body.attestationResponse,
        body.deviceHint,
      );
      res.json({
        success: true,
        message:
          body.deviceHint === "face"
            ? "Face enrolled on this device"
            : "Fingerprint enrolled on this device",
        data: { account },
      });
    } catch (err) {
      next(err);
    }
  },

  async webauthnLoginOptions(_req: Request, res: Response, next: NextFunction) {
    try {
      const options = await webauthnService.loginOptions();
      res.json({ success: true, data: { options } });
    } catch (err) {
      next(err);
    }
  },

  async webauthnLoginVerify(req: Request, res: Response, next: NextFunction) {
    try {
      const body = webauthnAuthSchema.parse(req.body);
      const result = await webauthnService.verifyLogin(body.assertionResponse);
      sendAuth(res, 200, result, "Fingerprint / face matched");
    } catch (err) {
      next(err);
    }
  },
};
