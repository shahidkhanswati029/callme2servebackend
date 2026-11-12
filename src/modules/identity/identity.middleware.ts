import type { NextFunction, Request, Response } from "express";
import type { Seat } from "@prisma/client";
import { AppError } from "../../shared/errors/AppError";
import { verifyAccessToken, type AccessPayload } from "../../shared/utils/tokens";

export type AuthenticatedRequest = Request & {
  auth?: AccessPayload;
};

function readAccessToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  const cookieToken = req.cookies?.cmts_access as string | undefined;
  return cookieToken || null;
}

export function requireAuth(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): void {
  const token = readAccessToken(req);
  if (!token) {
    next(new AppError("Missing access token", 401, "UNAUTHORIZED"));
    return;
  }

  try {
    req.auth = verifyAccessToken(token);
    next();
  } catch {
    next(new AppError("Invalid or expired access token", 401, "UNAUTHORIZED"));
  }
}

export function requireSeat(seat: Seat) {
  return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new AppError("Missing access token", 401, "UNAUTHORIZED"));
      return;
    }
    if (req.auth.seat !== seat) {
      next(new AppError("Forbidden for this seat", 403, "FORBIDDEN_SEAT"));
      return;
    }
    next();
  };
}
