import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { env } from "../../config/env";
import { prisma } from "../../shared/db/prisma";
import { AppError } from "../../shared/errors/AppError";
import {
  createRefreshToken,
  hashRefreshToken,
  signAccessToken,
} from "../../shared/utils/tokens";
import { identityRepository } from "./identity.repository";
import { toPublicAccount, type AuthResult, type PublicAccount } from "./identity.types";

const rpID = env.WEBAUTHN_RP_ID;
const rpName = env.WEBAUTHN_RP_NAME;
const challenges = new Map<string, { challenge: string; expiresAt: number }>();

function putChallenge(key: string, challenge: string) {
  challenges.set(key, { challenge, expiresAt: Date.now() + 5 * 60 * 1000 });
}

function takeChallenge(key: string): string {
  const row = challenges.get(key);
  challenges.delete(key);
  if (!row || row.expiresAt < Date.now()) {
    throw new AppError(
      "Biometric challenge expired. Try again.",
      400,
      "WEBAUTHN_CHALLENGE",
    );
  }
  return row.challenge;
}

function origins(): string | string[] {
  return env.corsOrigins.length ? env.corsOrigins : ["http://localhost:3000"];
}

async function issueSession(accountId: string): Promise<AuthResult> {
  const account = await identityRepository.findById(accountId);
  if (!account) throw new AppError("Account not found", 404, "NOT_FOUND");

  const credCount = await prisma.webAuthnCredential.count({ where: { accountId } });
  const refreshToken = createRefreshToken();
  await identityRepository.update(account.id, {
    refreshTokenHash: hashRefreshToken(refreshToken),
  });

  return {
    account: toPublicAccount(account, { hasWebAuthn: credCount > 0 }),
    tokens: {
      accessToken: signAccessToken({
        sub: account.id,
        email: account.email,
        seat: account.seat,
        name: account.name,
      }),
      refreshToken,
    },
  };
}

export const webauthnService = {
  async registrationOptions(accountId: string) {
    const account = await identityRepository.findById(accountId);
    if (!account) throw new AppError("Account not found", 404, "NOT_FOUND");

    const existing = await prisma.webAuthnCredential.findMany({
      where: { accountId },
    });

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: account.email,
      userDisplayName: account.name,
      userID: new TextEncoder().encode(account.id),
      attestationType: "none",
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        userVerification: "required",
      },
      excludeCredentials: existing.map((c) => ({
        id: c.credentialId,
        transports: c.transports as ("internal" | "usb" | "nfc" | "ble" | "hybrid")[],
      })),
    });

    putChallenge(`reg:${accountId}`, options.challenge);
    return options;
  },

  async verifyRegistration(
    accountId: string,
    response: RegistrationResponseJSON,
    deviceHint: "fingerprint" | "face" = "fingerprint",
  ): Promise<PublicAccount> {
    const expectedChallenge = takeChallenge(`reg:${accountId}`);
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origins(),
      expectedRPID: rpID,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new AppError(
        "Fingerprint / face enrollment failed",
        400,
        "WEBAUTHN_FAILED",
      );
    }

    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;

    await prisma.webAuthnCredential.create({
      data: {
        accountId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: BigInt(credential.counter),
        transports: response.response.transports ?? [],
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
      },
    });

    const current = await identityRepository.findById(accountId);
    if (!current) throw new AppError("Account not found", 404, "NOT_FOUND");

    const account = await identityRepository.update(accountId, {
      fingerprintEnrolled:
        deviceHint === "fingerprint" ? true : current.fingerprintEnrolled,
      faceEnrolled: deviceHint === "face" ? true : current.faceEnrolled,
    });
    return toPublicAccount(account, { hasWebAuthn: true });
  },

  async loginOptions() {
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "required",
    });
    putChallenge(`login:${options.challenge}`, options.challenge);
    return options;
  },

  async verifyLogin(response: AuthenticationResponseJSON): Promise<AuthResult> {
    const stored = await prisma.webAuthnCredential.findUnique({
      where: { credentialId: response.id },
    });
    if (!stored) {
      throw new AppError(
        "No enrolled fingerprint or face on this device. Sign in with Google or Facebook first, then enroll.",
        401,
        "WEBAUTHN_UNKNOWN",
      );
    }

    let challengeFromClient = "";
    try {
      const clientData = JSON.parse(
        Buffer.from(response.response.clientDataJSON, "base64url").toString("utf8"),
      ) as { challenge: string };
      challengeFromClient = clientData.challenge;
    } catch {
      throw new AppError("Invalid biometric response", 400, "WEBAUTHN_FAILED");
    }

    const expectedChallenge = takeChallenge(`login:${challengeFromClient}`);

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origins(),
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: stored.credentialId,
        publicKey: new Uint8Array(stored.publicKey),
        counter: Number(stored.counter),
        transports: stored.transports as ("internal" | "usb" | "nfc" | "ble" | "hybrid")[],
      },
    });

    if (!verification.verified) {
      throw new AppError(
        "Fingerprint / face did not match",
        401,
        "WEBAUTHN_FAILED",
      );
    }

    await prisma.webAuthnCredential.update({
      where: { id: stored.id },
      data: { counter: BigInt(verification.authenticationInfo.newCounter) },
    });

    return issueSession(stored.accountId);
  },
};
