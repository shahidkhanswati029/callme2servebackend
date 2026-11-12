import type { CookieOptions, Response } from "express";
import { env } from "../../config/env";

const isProd = env.NODE_ENV === "production";

const base: CookieOptions = {
  httpOnly: true,
  // Local HTTP must not use Secure, or browsers drop the cookie.
  secure: isProd ? true : Boolean(env.COOKIE_SECURE),
  // Lax works for localhost:3000 → localhost:4000 credentialed fetches.
  // Production cross-site frontends need SameSite=None + Secure.
  sameSite: isProd ? "none" : "lax",
  path: "/",
};

export function setAuthCookies(
  res: Response,
  tokens: { accessToken: string; refreshToken: string },
) {
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  res.cookie("cmts_access", tokens.accessToken, {
    ...base,
    maxAge: weekMs,
  });
  res.cookie("cmts_refresh", tokens.refreshToken, {
    ...base,
    maxAge: weekMs,
  });
}

export function clearAuthCookies(res: Response) {
  const clearOpts: CookieOptions = {
    path: "/",
    httpOnly: true,
    secure: base.secure,
    sameSite: base.sameSite,
  };
  res.clearCookie("cmts_access", clearOpts);
  res.clearCookie("cmts_refresh", clearOpts);
}
