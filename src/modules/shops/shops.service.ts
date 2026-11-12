import { Seat, ShopStatus, type Shop } from "@prisma/client";
import { prisma } from "../../shared/db/prisma";
import { AppError } from "../../shared/errors/AppError";
import { haversineMetres } from "../../shared/geo/distance";

function requiredFieldsForType(type: string): string[] {
  if (type === "surgical") return ["maker", "institute", "factory"];
  if (type === "leather") return ["company"];
  return [];
}

function publishState(shop: {
  latitude: number | null;
  longitude: number | null;
  doorPhotoUrl: string | null;
}): { status: ShopStatus; heldReason: string | null } {
  if (shop.latitude == null || shop.longitude == null) {
    return { status: ShopStatus.HELD, heldReason: "Live pin missing" };
  }
  if (!shop.doorPhotoUrl) {
    return { status: ShopStatus.HELD, heldReason: "Door photo missing" };
  }
  return { status: ShopStatus.LIVE, heldReason: null };
}

function toPublic(shop: Shop) {
  return {
    id: shop.id,
    ownerId: shop.ownerId,
    type: shop.type,
    name: shop.name,
    typeFields: shop.typeFields as Record<string, string>,
    street: shop.street,
    latitude: shop.latitude,
    longitude: shop.longitude,
    accuracyM: shop.accuracyM,
    pointUpdatedAt: shop.pointUpdatedAt,
    doorPhotoUrl: shop.doorPhotoUrl,
    status: shop.status,
    heldReason: shop.heldReason,
    createdAt: shop.createdAt,
    updatedAt: shop.updatedAt,
  };
}

export const shopsService = {
  async listMine(accountId: string) {
    const shops = await prisma.shop.findMany({
      where: { ownerId: accountId },
      orderBy: { createdAt: "desc" },
    });
    return shops.map(toPublic);
  },

  async create(
    accountId: string,
    input: {
      type: string;
      name: string;
      typeFields: Record<string, string>;
      street?: string;
    },
  ) {
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.seat !== Seat.EXPERT) {
      throw new AppError("Only experts can open a shop", 403, "WRONG_SEAT");
    }

    const existing = await prisma.shop.count({ where: { ownerId: accountId } });
    if (existing >= 1) {
      throw new AppError("One shop per expert for now", 409, "SHOP_LIMIT");
    }

    for (const key of requiredFieldsForType(input.type)) {
      if (!input.typeFields[key]?.trim()) {
        throw new AppError(`Missing required field: ${key}`, 400, "SHOP_FIELDS");
      }
    }

    const held = publishState({
      latitude: null,
      longitude: null,
      doorPhotoUrl: null,
    });

    const shop = await prisma.shop.create({
      data: {
        ownerId: accountId,
        type: input.type,
        name: input.name,
        typeFields: input.typeFields,
        street: input.street,
        status: held.status,
        heldReason: held.heldReason,
      },
    });

    return toPublic(shop);
  },

  async update(
    accountId: string,
    shopId: string,
    input: {
      name?: string;
      typeFields?: Record<string, string>;
      street?: string | null;
    },
  ) {
    const shop = await prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop || shop.ownerId !== accountId) {
      throw new AppError("Shop not found", 404, "NOT_FOUND");
    }

    const typeFields = {
      ...(shop.typeFields as Record<string, string>),
      ...(input.typeFields || {}),
    };
    for (const key of requiredFieldsForType(shop.type)) {
      if (!typeFields[key]?.trim()) {
        throw new AppError(`Missing required field: ${key}`, 400, "SHOP_FIELDS");
      }
    }

    const updated = await prisma.shop.update({
      where: { id: shopId },
      data: {
        name: input.name ?? shop.name,
        typeFields,
        street: input.street === undefined ? shop.street : input.street,
      },
    });
    return toPublic(updated);
  },

  async savePin(
    accountId: string,
    shopId: string,
    input: { latitude: number; longitude: number; accuracyM?: number },
  ) {
    const shop = await prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop || shop.ownerId !== accountId) {
      throw new AppError("Shop not found", 404, "NOT_FOUND");
    }

    const next = {
      latitude: input.latitude,
      longitude: input.longitude,
      doorPhotoUrl: shop.doorPhotoUrl,
    };
    const pub = publishState(next);

    const updated = await prisma.shop.update({
      where: { id: shopId },
      data: {
        latitude: input.latitude,
        longitude: input.longitude,
        accuracyM: input.accuracyM ?? null,
        pointUpdatedAt: new Date(),
        status: pub.status,
        heldReason: pub.heldReason,
      },
    });
    return toPublic(updated);
  },

  async setDoorPhoto(accountId: string, shopId: string, doorPhotoUrl: string) {
    const shop = await prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop || shop.ownerId !== accountId) {
      throw new AppError("Shop not found", 404, "NOT_FOUND");
    }

    const pub = publishState({
      latitude: shop.latitude,
      longitude: shop.longitude,
      doorPhotoUrl,
    });

    const updated = await prisma.shop.update({
      where: { id: shopId },
      data: {
        doorPhotoUrl,
        status: pub.status,
        heldReason: pub.heldReason,
      },
    });
    return toPublic(updated);
  },

  async nearbyLive(accountId: string, km = 5) {
    const me = await prisma.account.findUnique({ where: { id: accountId } });
    if (!me?.latitude || !me.longitude) {
      throw new AppError("Set your place pin first", 400, "PLACE_REQUIRED");
    }

    const shops = await prisma.shop.findMany({
      where: {
        status: ShopStatus.LIVE,
        latitude: { not: null },
        longitude: { not: null },
        NOT: { ownerId: accountId },
      },
      include: { owner: { select: { name: true, rating: true } } },
    });

    const maxM = km * 1000;
    return shops
      .map((s) => {
        const distanceM = haversineMetres(
          me.latitude!,
          me.longitude!,
          s.latitude!,
          s.longitude!,
        );
        return {
          ...toPublic(s),
          ownerName: s.owner.name,
          ownerRating: s.owner.rating,
          distanceM: Math.round(distanceM),
          distanceKm: Math.round((distanceM / 1000) * 10) / 10,
        };
      })
      .filter((s) => s.distanceM <= maxM)
      .sort((a, b) => a.distanceM - b.distanceM);
  },
};
