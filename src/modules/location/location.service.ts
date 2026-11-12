import { Seat } from "@prisma/client";
import { prisma } from "../../shared/db/prisma";
import { AppError } from "../../shared/errors/AppError";
import { haversineMetres } from "../../shared/geo/distance";
import { toPublicAccount } from "../identity/identity.types";

const COUNTRY_CURRENCY: Record<string, string> = {
  PK: "PKR",
  AE: "AED",
  GB: "GBP",
  US: "USD",
  IN: "INR",
  SA: "SAR",
  CA: "CAD",
  AU: "AUD",
  DE: "EUR",
  FR: "EUR",
  TR: "TRY",
};

export const locationService = {
  async getMine(accountId: string) {
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new AppError("Account not found", 404, "NOT_FOUND");
    return {
      account: toPublicAccount(account),
      place: {
        placeLabel: account.placeLabel,
        city: account.city,
        country: account.country,
        currency: account.currency,
        latitude: account.latitude,
        longitude: account.longitude,
        accuracyM: account.placeAccuracyM,
        updatedAt: account.placeUpdatedAt,
        rating: account.rating,
      },
    };
  },

  async savePlace(
    accountId: string,
    input: {
      placeLabel: string;
      city?: string;
      country?: string;
      currency?: string;
      latitude: number;
      longitude: number;
      accuracyM?: number;
    },
  ) {
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new AppError("Account not found", 404, "NOT_FOUND");
    if (account.seat !== Seat.EXPERT) {
      throw new AppError("Only experts have a personal pin", 403, "WRONG_SEAT");
    }

    const country = input.country || account.country;
    const currency =
      input.currency || COUNTRY_CURRENCY[country] || account.currency;

    const updated = await prisma.account.update({
      where: { id: accountId },
      data: {
        placeLabel: input.placeLabel,
        city: input.city || input.placeLabel.split(",").pop()?.trim() || account.city,
        country,
        currency,
        latitude: input.latitude,
        longitude: input.longitude,
        placeAccuracyM: input.accuracyM ?? null,
        placeUpdatedAt: new Date(),
      },
    });

    return {
      account: toPublicAccount(updated),
      place: {
        placeLabel: updated.placeLabel,
        city: updated.city,
        country: updated.country,
        currency: updated.currency,
        latitude: updated.latitude,
        longitude: updated.longitude,
        accuracyM: updated.placeAccuracyM,
        updatedAt: updated.placeUpdatedAt,
        rating: updated.rating,
      },
      message: "Place saved. Your shop pin did not move.",
    };
  },

  async nearby(
    accountId: string,
    km = 5,
    filters?: { category?: string; q?: string },
  ) {
    const me = await prisma.account.findUnique({ where: { id: accountId } });
    if (!me?.latitude || !me.longitude) {
      throw new AppError(
        "Set your place pin before viewing nearby experts",
        400,
        "PLACE_REQUIRED",
      );
    }

    const experts = await prisma.account.findMany({
      where: {
        seat: Seat.EXPERT,
        latitude: { not: null },
        longitude: { not: null },
        NOT: { id: accountId },
        ...(filters?.category
          ? { work: { contains: filters.category, mode: "insensitive" } }
          : {}),
        ...(filters?.q
          ? {
              OR: [
                { name: { contains: filters.q, mode: "insensitive" } },
                { work: { contains: filters.q, mode: "insensitive" } },
                { placeLabel: { contains: filters.q, mode: "insensitive" } },
                { city: { contains: filters.q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
    });

    const maxM = km * 1000;
    const { presence } = await import("../../shared/presence");
    return experts
      .map((e) => {
        const distanceM = haversineMetres(
          me.latitude!,
          me.longitude!,
          e.latitude!,
          e.longitude!,
        );
        const rating = Number(e.rating || 0);
        const ratingCount = e.ratingCount || 0;
        return {
          id: e.id,
          name: e.name,
          work: e.work,
          placeLabel: e.placeLabel,
          city: e.city,
          country: e.country,
          rating,
          ratingCount,
          topRanked: rating >= 4.5 && ratingCount >= 3,
          package: e.package,
          latitude: e.latitude,
          longitude: e.longitude,
          isOnline: presence.isOnline(e.id) || e.isOnline,
          distanceM: Math.round(distanceM),
          distanceKm: Math.round((distanceM / 1000) * 10) / 10,
        };
      })
      .filter((e) => e.distanceM <= maxM)
      .sort((a, b) => {
        // Top-ranked within 5 km float above equal distance peers.
        if (a.topRanked !== b.topRanked) return a.topRanked ? -1 : 1;
        return a.distanceM - b.distanceM;
      });
  },
};
