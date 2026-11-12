import { Seat, ShopStatus } from "@prisma/client";
import { prisma } from "../../shared/db/prisma";
import { citiesForCountry } from "../../shared/countryCities";
import { env } from "../../config/env";

const DESK_ADMIN_EMAIL = env.DESK_ADMIN_EMAIL;

async function ensureDeskInboxes() {
  const desks = await prisma.account.findMany({
    where: { seat: Seat.DESK },
    select: { id: true, email: true },
  });

  const hasAdmin = desks.some((d) => d.email.toLowerCase() === DESK_ADMIN_EMAIL.toLowerCase());
  if (!hasAdmin) {
    const existing = await prisma.account.findUnique({ where: { email: DESK_ADMIN_EMAIL } });
    if (existing) {
      if (existing.seat !== Seat.DESK) {
        const updated = await prisma.account.update({
          where: { id: existing.id },
          data: { seat: Seat.DESK },
          select: { id: true, email: true },
        });
        desks.push(updated);
      } else {
        desks.push({ id: existing.id, email: existing.email });
      }
    } else {
      const created = await prisma.account.create({
        data: {
          email: DESK_ADMIN_EMAIL,
          name: "Super Admin",
          city: "Sialkot",
          country: "PK",
          currency: "PKR",
          seat: Seat.DESK,
          fingerprintEnrolled: false,
          faceEnrolled: false,
        },
        select: { id: true, email: true },
      });
      desks.push(created);
    }
  }

  return desks;
}

export const publicService = {
  async search(filters: {
    q?: string;
    city?: string;
    category?: string;
    country?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, filters.page || 1);
    const pageSize = Math.min(40, Math.max(1, filters.pageSize || 12));
    const where: Record<string, unknown> = {
      seat: Seat.EXPERT,
      latitude: { not: null },
      longitude: { not: null },
    };
    if (filters.country?.trim()) {
      where.country = filters.country.trim().toUpperCase();
    }
    if (filters.city?.trim()) {
      where.city = { contains: filters.city.trim(), mode: "insensitive" };
    }
    if (filters.category?.trim() && filters.category !== "All") {
      where.work = { contains: filters.category.trim(), mode: "insensitive" };
    }
    if (filters.q?.trim()) {
      const q = filters.q.trim();
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { work: { contains: q, mode: "insensitive" } },
        { placeLabel: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
      ];
    }

    const [total, experts, liveShops] = await Promise.all([
      prisma.account.count({ where }),
      prisma.account.findMany({
        where,
        select: {
          id: true,
          name: true,
          work: true,
          city: true,
          country: true,
          placeLabel: true,
          photoUrl: true,
          rating: true,
          ratingCount: true,
          package: true,
          isOnline: true,
        },
        orderBy: [{ rating: "desc" }, { ratingCount: "desc" }, { updatedAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.shop.count({
        where: {
          status: ShopStatus.LIVE,
          ...(filters.country?.trim()
            ? { owner: { country: filters.country.trim().toUpperCase() } }
            : {}),
          ...(filters.city?.trim()
            ? {
                OR: [
                  { street: { contains: filters.city.trim(), mode: "insensitive" } },
                  { owner: { city: { contains: filters.city.trim(), mode: "insensitive" } } },
                ],
              }
            : {}),
        },
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      liveShops,
      experts: experts.map((e) => ({
        ...e,
        topRanked: Number(e.rating) >= 4.5 && (e.ratingCount || 0) >= 3,
      })),
    };
  },

  async cities(country?: string) {
    const code = (country || "PK").toUpperCase();
    const focus = citiesForCountry(code);

    const rows = await prisma.account.groupBy({
      by: ["city"],
      where: {
        seat: Seat.EXPERT,
        country: code,
        city: { not: null },
        latitude: { not: null },
        longitude: { not: null },
      },
      _count: { _all: true },
      orderBy: { _count: { city: "desc" } },
      take: 40,
    });

    const liveShops = await prisma.shop.findMany({
      where: { status: ShopStatus.LIVE, owner: { country: code } },
      select: { owner: { select: { city: true } } },
    });
    const shopsByCity = new Map<string, number>();
    for (const s of liveShops) {
      const city = s.owner.city;
      if (!city) continue;
      shopsByCity.set(city, (shopsByCity.get(city) || 0) + 1);
    }

    const fromDb = rows
      .filter((r) => r.city)
      .map((r) => ({
        city: r.city as string,
        experts: r._count._all,
        shops: shopsByCity.get(r.city as string) || 0,
        country: code,
      }));

    const byName = new Map(fromDb.map((c) => [c.city.toLowerCase(), c]));
    for (const city of focus) {
      if (!byName.has(city.toLowerCase())) {
        fromDb.push({ city, experts: 0, shops: 0, country: code });
      }
    }

    return fromDb.sort((a, b) => b.experts - a.experts || a.city.localeCompare(b.city));
  },

  async overview(country?: string) {
    const code = country?.trim() ? country.trim().toUpperCase() : undefined;
    const expertWhere: { seat: Seat; country?: string } = {
      seat: Seat.EXPERT,
      ...(code ? { country: code } : {}),
    };
    const [experts, online, shops, ratings, cities] = await Promise.all([
      prisma.account.count({ where: expertWhere }),
      prisma.account.count({ where: { ...expertWhere, isOnline: true } }),
      prisma.shop.count({
        where: {
          status: ShopStatus.LIVE,
          ...(code ? { owner: { country: code } } : {}),
        },
      }),
      prisma.rating.aggregate({
        where: code ? { to: { country: code } } : undefined,
        _avg: { stars: true },
        _count: { _all: true },
      }),
      prisma.account.findMany({
        where: { ...expertWhere, city: { not: null } },
        select: { city: true },
        distinct: ["city"],
      }),
    ]);
    return {
      experts,
      online,
      liveShops: shops,
      ratingAvg: Number((ratings._avg.stars || 0).toFixed(1)),
      ratingCount: ratings._count._all,
      cities: cities.length,
      country: code || "ALL",
    };
  },

  async reviews(take = 8, country?: string) {
    const rows = await prisma.rating.findMany({
      where: {
        text: { not: null },
        ...(country?.trim()
          ? { to: { country: country.trim().toUpperCase() } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take,
      include: {
        from: { select: { name: true, photoUrl: true, work: true, city: true } },
        to: { select: { name: true, work: true, city: true } },
      },
    });
    return rows
      .filter((r) => (r.text || "").trim().length > 0)
      .map((r) => ({
        id: r.id,
        stars: r.stars,
        text: r.text,
        createdAt: r.createdAt,
        from: r.from,
        about: r.to,
      }));
  },

  async categories(country?: string) {
    const rows = await prisma.account.groupBy({
      by: ["work"],
      where: {
        seat: Seat.EXPERT,
        work: { not: null },
        ...(country?.trim() ? { country: country.trim().toUpperCase() } : {}),
      },
      _count: { _all: true },
      orderBy: { _count: { work: "desc" } },
      take: 24,
    });
    return rows
      .filter((r) => r.work)
      .map((r) => ({ name: r.work as string, experts: r._count._all }));
  },

  async contact(input: {
    name: string;
    email: string;
    message: string;
    city?: string;
    country?: string;
    kind?: "CONTACT" | "COMPLAINT";
    subject?: string;
  }) {
    const kind = input.kind === "COMPLAINT" ? "COMPLAINT" : "CONTACT";
    const inquiry = await prisma.contactInquiry.create({
      data: {
        kind,
        status: "OPEN",
        name: input.name,
        email: input.email,
        city: input.city || null,
        country: input.country || null,
        subject: input.subject || null,
        message: input.message,
      },
    });

    const desks = await ensureDeskInboxes();
    if (desks.length > 0) {
      const label = kind === "COMPLAINT" ? "Complaint" : "Contact";
      await prisma.notification.createMany({
        data: desks.map((d) => ({
          accountId: d.id,
          kind: "SYSTEM" as const,
          title: `${label} · ${input.name}`,
          body: `${input.email}${input.city ? ` · ${input.city}` : ""}: ${input.message.slice(0, 400)}`,
          data: {
            contact: true,
            complaint: kind === "COMPLAINT",
            inquiryId: inquiry.id,
            email: input.email,
            name: input.name,
            city: input.city || null,
            subject: input.subject || null,
            message: input.message,
            kind,
          },
        })),
      });
    }
    return {
      ok: true,
      inquiryId: inquiry.id,
      kind,
      routedToDesk: desks.length,
      deskEmails: desks.map((d) => d.email),
    };
  },
};
