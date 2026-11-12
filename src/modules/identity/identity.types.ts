import type { Account, Seat } from "@prisma/client";

export type ProfilePiece = {
  key: "name" | "work" | "photo" | "place" | "payout";
  label: string;
  done: boolean;
};

export type PublicAccount = {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  city: string | null;
  work: string | null;
  languages: string[];
  uiLanguage: string;
  country: string;
  currency: string;
  package: Account["package"];
  seat: Seat;
  placeLabel: string | null;
  photoUrl: string | null;
  payoutAccountSet: boolean;
  referralCode: string | null;
  referredById: string | null;
  latitude: number | null;
  longitude: number | null;
  rating: number;
  ratingCount: number;
  fingerprintEnrolled: boolean;
  faceEnrolled: boolean;
  isOnline: boolean;
  lastSeenAt: string | null;
  hasGoogle: boolean;
  hasFacebook: boolean;
  hasPassword: boolean;
  hasWebAuthn: boolean;
  profilePercent: number;
  profileDoneCount: number;
  profilePieces: ProfilePiece[];
};

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export type AuthResult = {
  account: PublicAccount;
  tokens: AuthTokens;
};

function buildProfile(account: Account): Pick<
  PublicAccount,
  "profilePercent" | "profileDoneCount" | "profilePieces"
> {
  const pieces: ProfilePiece[] = [
    { key: "name", label: "Name", done: Boolean(account.name?.trim()) },
    { key: "work", label: "Work", done: Boolean(account.work?.trim()) },
    { key: "photo", label: "Photo", done: Boolean(account.photoUrl) },
    {
      key: "place",
      label: "Place",
      done: Boolean(account.placeLabel?.trim() || account.city?.trim()),
    },
    { key: "payout", label: "Payout account", done: account.payoutAccountSet },
  ];
  const doneCount = pieces.filter((p) => p.done).length;
  return {
    profilePieces: pieces,
    profileDoneCount: doneCount,
    profilePercent: Math.round((doneCount / pieces.length) * 100),
  };
}

export function toPublicAccount(
  account: Account,
  extras?: { hasWebAuthn?: boolean },
): PublicAccount {
  const profile = buildProfile(account);
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    phone: account.phone,
    city: account.city,
    work: account.work,
    languages: account.languages,
    uiLanguage: account.uiLanguage || "en",
    country: account.country,
    currency: account.currency,
    package: account.package,
    seat: account.seat,
    placeLabel: account.placeLabel,
    photoUrl: account.photoUrl,
    payoutAccountSet: account.payoutAccountSet,
    referralCode: account.referralCode,
    referredById: account.referredById,
    latitude: account.latitude,
    longitude: account.longitude,
    rating: account.rating,
    ratingCount: account.ratingCount,
    fingerprintEnrolled: account.fingerprintEnrolled,
    faceEnrolled: account.faceEnrolled,
    isOnline: account.isOnline,
    lastSeenAt: account.lastSeenAt?.toISOString() ?? null,
    hasGoogle: Boolean(account.googleId),
    hasFacebook: Boolean(account.facebookId),
    hasPassword: Boolean(account.passwordHash),
    hasWebAuthn: Boolean(extras?.hasWebAuthn),
    ...profile,
  };
}
