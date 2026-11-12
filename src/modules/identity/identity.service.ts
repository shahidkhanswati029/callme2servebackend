import { OAuth2Client } from "google-auth-library";
import { Seat } from "@prisma/client";
import { env } from "../../config/env";
import { AppError } from "../../shared/errors/AppError";
import { hashPassword, verifyPassword } from "../../shared/utils/password";
import {
  createRefreshToken,
  hashRefreshToken,
  signAccessToken,
} from "../../shared/utils/tokens";
import { identityRepository } from "./identity.repository";
import {
  toPublicAccount,
  type AuthResult,
  type PublicAccount,
} from "./identity.types";

const googleClient = env.GOOGLE_CLIENT_ID
  ? new OAuth2Client(env.GOOGLE_CLIENT_ID)
  : null;

async function hasWebAuthn(accountId: string): Promise<boolean> {
  const { prisma } = await import("../../shared/db/prisma");
  const count = await prisma.webAuthnCredential.count({ where: { accountId } });
  return count > 0;
}

async function issueSession(accountId: string): Promise<AuthResult> {
  const account = await identityRepository.findById(accountId);
  if (!account) {
    throw new AppError("Account not found", 404, "NOT_FOUND");
  }

  const refreshToken = createRefreshToken();
  await identityRepository.update(account.id, {
    refreshTokenHash: hashRefreshToken(refreshToken),
  });

  const accessToken = signAccessToken({
    sub: account.id,
    email: account.email,
    seat: account.seat,
    name: account.name,
  });

  return {
    account: toPublicAccount(account, { hasWebAuthn: await hasWebAuthn(accountId) }),
    tokens: { accessToken, refreshToken },
  };
}

export const identityService = {
  async registerExpert(input: {
    name: string;
    email: string;
    password: string;
    phone?: string;
    city?: string;
    work?: string;
    languages?: string[];
  }): Promise<AuthResult> {
    const existing = await identityRepository.findByEmail(input.email);
    if (existing) {
      throw new AppError("Email already registered", 409, "EMAIL_TAKEN");
    }

    const account = await identityRepository.create({
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      phone: input.phone,
      city: input.city,
      work: input.work,
      languages: input.languages ?? [],
      seat: Seat.EXPERT,
    });

    return issueSession(account.id);
  },

  async loginWithPassword(
    email: string,
    password: string,
    requiredSeat?: Seat,
  ): Promise<AuthResult> {
    const account = await identityRepository.findByEmail(email);
    if (!account || !account.passwordHash) {
      throw new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS");
    }

    if (requiredSeat && account.seat !== requiredSeat) {
      throw new AppError(
        requiredSeat === Seat.DESK
          ? "This account is not a desk seat"
          : "This account is not an expert seat",
        403,
        "WRONG_SEAT",
      );
    }

    const ok = await verifyPassword(password, account.passwordHash);
    if (!ok) {
      throw new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS");
    }

    return issueSession(account.id);
  },

  /** Desk operators sign in with email only — no password field on the product. */
  async deskLoginByEmail(email: string): Promise<AuthResult> {
    const account = await identityRepository.findByEmail(email);
    if (!account || account.seat !== Seat.DESK) {
      throw new AppError("Desk seat not found for this email", 401, "INVALID_CREDENTIALS");
    }
    return issueSession(account.id);
  },

  async refresh(refreshToken: string): Promise<AuthResult> {
    const account = await identityRepository.findByRefreshTokenHash(
      hashRefreshToken(refreshToken),
    );
    if (!account) {
      throw new AppError("Invalid refresh token", 401, "INVALID_REFRESH");
    }
    return issueSession(account.id);
  },

  async logout(accountId: string): Promise<void> {
    await identityRepository.clearRefreshToken(accountId);
  },

  async me(accountId: string): Promise<PublicAccount> {
    const account = await identityRepository.findById(accountId);
    if (!account) {
      throw new AppError("Account not found", 404, "NOT_FOUND");
    }
    return toPublicAccount(account, {
      hasWebAuthn: await hasWebAuthn(accountId),
    });
  },

  async enrollBiometrics(
    accountId: string,
    flags: { fingerprintEnrolled?: boolean; faceEnrolled?: boolean },
  ): Promise<PublicAccount> {
    const data: { fingerprintEnrolled?: boolean; faceEnrolled?: boolean } = {};
    if (flags.fingerprintEnrolled !== undefined) {
      data.fingerprintEnrolled = flags.fingerprintEnrolled;
    }
    if (flags.faceEnrolled !== undefined) {
      data.faceEnrolled = flags.faceEnrolled;
    }
    const account = await identityRepository.update(accountId, data);
    return toPublicAccount(account, {
      hasWebAuthn: await hasWebAuthn(accountId),
    });
  },

  async saveDetails(
    accountId: string,
    input: {
      work: string;
      languages: string[];
      city: string;
      phone?: string;
      placeLabel?: string;
    },
  ): Promise<PublicAccount> {
    const account = await identityRepository.update(accountId, {
      work: input.work,
      languages: input.languages,
      city: input.city,
      placeLabel: input.placeLabel || input.city,
      ...(input.phone ? { phone: input.phone } : {}),
    });
    return toPublicAccount(account, {
      hasWebAuthn: await hasWebAuthn(accountId),
    });
  },

  async savePhoto(accountId: string, photoUrl: string): Promise<PublicAccount> {
    const account = await identityRepository.update(accountId, { photoUrl });
    return toPublicAccount(account, {
      hasWebAuthn: await hasWebAuthn(accountId),
    });
  },

  async loginWithGoogle(input: {
    idToken: string;
    phone?: string;
    city?: string;
  }): Promise<AuthResult> {
    if (!googleClient || !env.GOOGLE_CLIENT_ID) {
      throw new AppError(
        "Google sign-in is not configured. Set GOOGLE_CLIENT_ID.",
        503,
        "GOOGLE_NOT_CONFIGURED",
      );
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: input.idToken,
      audience: env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.email || !payload.sub) {
      throw new AppError("Google token missing email", 401, "GOOGLE_INVALID");
    }

    const email = payload.email.toLowerCase();
    let account =
      (await identityRepository.findByGoogleId(payload.sub)) ||
      (await identityRepository.findByEmail(email));

    if (account) {
      if (account.seat === Seat.DESK) {
        throw new AppError(
          "Desk seats cannot use Google sign-in",
          403,
          "DESK_SOCIAL_FORBIDDEN",
        );
      }
      if (!account.googleId) {
        account = await identityRepository.update(account.id, {
          googleId: payload.sub,
          name: account.name || payload.name || email,
        });
      }
    } else {
      account = await identityRepository.create({
        email,
        name: payload.name || email.split("@")[0],
        googleId: payload.sub,
        phone: input.phone,
        city: input.city,
        seat: Seat.EXPERT,
      });
    }

    return issueSession(account.id);
  },

  async loginWithFacebook(input: {
    accessToken: string;
    phone?: string;
    city?: string;
  }): Promise<AuthResult> {
    if (!env.FACEBOOK_APP_ID || !env.FACEBOOK_APP_SECRET) {
      throw new AppError(
        "Facebook sign-in is not configured. Set FACEBOOK_APP_ID and FACEBOOK_APP_SECRET.",
        503,
        "FACEBOOK_NOT_CONFIGURED",
      );
    }

    const debugUrl = new URL("https://graph.facebook.com/debug_token");
    debugUrl.searchParams.set("input_token", input.accessToken);
    debugUrl.searchParams.set(
      "access_token",
      `${env.FACEBOOK_APP_ID}|${env.FACEBOOK_APP_SECRET}`,
    );

    const debugRes = await fetch(debugUrl);
    const debugJson = (await debugRes.json()) as {
      data?: { is_valid?: boolean; app_id?: string; user_id?: string };
    };

    if (
      !debugJson.data?.is_valid ||
      debugJson.data.app_id !== env.FACEBOOK_APP_ID ||
      !debugJson.data.user_id
    ) {
      throw new AppError("Facebook token invalid", 401, "FACEBOOK_INVALID");
    }

    const profileUrl = new URL(`https://graph.facebook.com/${debugJson.data.user_id}`);
    profileUrl.searchParams.set("fields", "id,name,email");
    profileUrl.searchParams.set("access_token", input.accessToken);

    const profileRes = await fetch(profileUrl);
    const profile = (await profileRes.json()) as {
      id?: string;
      name?: string;
      email?: string;
      error?: { message?: string };
    };

    if (!profile.id || profile.error) {
      throw new AppError(
        profile.error?.message || "Facebook profile failed",
        401,
        "FACEBOOK_INVALID",
      );
    }

    if (!profile.email) {
      throw new AppError(
        "Facebook did not return an email. Grant email permission.",
        400,
        "FACEBOOK_EMAIL_REQUIRED",
      );
    }

    const email = profile.email.toLowerCase();
    let account =
      (await identityRepository.findByFacebookId(profile.id)) ||
      (await identityRepository.findByEmail(email));

    if (account) {
      if (account.seat === Seat.DESK) {
        throw new AppError(
          "Desk seats cannot use Facebook sign-in",
          403,
          "DESK_SOCIAL_FORBIDDEN",
        );
      }
      if (!account.facebookId) {
        account = await identityRepository.update(account.id, {
          facebookId: profile.id,
          name: account.name || profile.name || email,
        });
      }
    } else {
      account = await identityRepository.create({
        email,
        name: profile.name || email.split("@")[0],
        facebookId: profile.id,
        phone: input.phone,
        city: input.city,
        seat: Seat.EXPERT,
      });
    }

    return issueSession(account.id);
  },
};
