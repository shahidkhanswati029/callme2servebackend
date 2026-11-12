import {
  JobStatus,
  LedgerKind,
  PackageTier,
  PaymentRail,
  Seat,
  ShopStatus,
} from "@prisma/client";
import { prisma } from "../../shared/db/prisma";
import { AppError } from "../../shared/errors/AppError";
import { env } from "../../config/env";

const DESK_ADMIN_EMAIL = env.DESK_ADMIN_EMAIL;

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

export const deskService = {
  async board() {
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const fortnightAgo = new Date(startToday);
    fortnightAgo.setDate(fortnightAgo.getDate() - 13);

    const [
      experts,
      shops,
      liveShops,
      heldShops,
      packageGroups,
      jobsToday,
      commissionAgg,
      packageFeeAgg,
      referralAgg,
      recentJobs,
      onlineExperts,
      pendingPayouts,
      statusGroups,
      railGroups,
      recentSignups,
      recentLedger,
      openJobs,
      inProgressJobs,
      receiptsToday,
    ] = await Promise.all([
      prisma.account.count({ where: { seat: Seat.EXPERT } }),
      prisma.shop.count(),
      prisma.shop.count({ where: { status: ShopStatus.LIVE } }),
      prisma.shop.count({ where: { status: ShopStatus.HELD } }),
      prisma.account.groupBy({
        by: ["package"],
        where: { seat: Seat.EXPERT },
        _count: { package: true },
      }),
      prisma.job.count({
        where: { completedAt: { gte: startToday }, status: JobStatus.COMPLETED },
      }),
      prisma.ledgerLine.aggregate({
        where: { kind: LedgerKind.COMMISSION },
        _sum: { amount: true },
      }),
      prisma.ledgerLine.aggregate({
        where: { kind: LedgerKind.PACKAGE_FEE },
        _sum: { amount: true },
      }),
      prisma.ledgerLine.aggregate({
        where: { kind: LedgerKind.REFERRAL_SHARE },
        _sum: { amount: true },
      }),
      prisma.job.findMany({
        where: { createdAt: { gte: fortnightAgo } },
        select: {
          createdAt: true,
          completedAt: true,
          status: true,
          commission: true,
          quotation: true,
          visitFee: true,
          rail: true,
        },
      }),
      prisma.account.count({ where: { seat: Seat.EXPERT, isOnline: true } }),
      prisma.ledgerLine.aggregate({
        where: { kind: LedgerKind.NET_PAYOUT },
        _sum: { amount: true },
      }),
      prisma.job.groupBy({
        by: ["status"],
        _count: { status: true },
      }),
      prisma.job.groupBy({
        by: ["rail"],
        where: { rail: { not: null }, status: JobStatus.COMPLETED },
        _count: { rail: true },
        _sum: { commission: true },
      }),
      prisma.account.findMany({
        where: { seat: Seat.EXPERT, createdAt: { gte: fortnightAgo } },
        select: { createdAt: true },
      }),
      prisma.ledgerLine.findMany({
        where: { createdAt: { gte: fortnightAgo } },
        select: { createdAt: true, kind: true, amount: true },
      }),
      prisma.job.count({ where: { status: JobStatus.OPEN } }),
      prisma.job.count({ where: { status: JobStatus.ACCEPTED } }),
      prisma.paymentReceipt.count({ where: { createdAt: { gte: startToday } } }),
    ]);

    const releasedAgg = await prisma.ledgerLine.aggregate({
      where: { kind: LedgerKind.PAYOUT_RELEASE },
      _sum: { amount: true },
    });

    const packages = {
      FREE: 0,
      SILVER: 0,
      GOLD: 0,
      PLATINUM: 0,
    } as Record<PackageTier, number>;
    for (const g of packageGroups) packages[g.package] = g._count.package;

    const seriesMap = new Map<
      string,
      {
        day: string;
        jobs: number;
        commission: number;
        volume: number;
        signups: number;
        ledgerIn: number;
      }
    >();
    for (let i = 0; i < 14; i++) {
      const d = new Date(fortnightAgo);
      d.setDate(fortnightAgo.getDate() + i);
      const key = dayKey(d);
      seriesMap.set(key, {
        day: d.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
        jobs: 0,
        commission: 0,
        volume: 0,
        signups: 0,
        ledgerIn: 0,
      });
    }
    for (const job of recentJobs) {
      const key = dayKey(job.completedAt || job.createdAt);
      const row = seriesMap.get(key);
      if (!row) continue;
      if (job.status === JobStatus.COMPLETED) {
        row.jobs += 1;
        row.commission += job.commission;
        row.volume += (job.quotation || 0) + (job.visitFee || 0);
      }
    }
    for (const a of recentSignups) {
      const row = seriesMap.get(dayKey(a.createdAt));
      if (row) row.signups += 1;
    }
    for (const line of recentLedger) {
      const row = seriesMap.get(dayKey(line.createdAt));
      if (!row) continue;
      if (
        line.kind === LedgerKind.COMMISSION ||
        line.kind === LedgerKind.PACKAGE_FEE
      ) {
        row.ledgerIn += Math.abs(line.amount);
      }
    }
    const jobsSeries = [...seriesMap.values()];

    const jobStatusMix = statusGroups.map((g) => ({
      label: g.status,
      value: g._count.status,
    }));

    const railMix = railGroups.map((g) => ({
      label: g.rail || "UNKNOWN",
      value: g._count.rail,
      commission: Math.round((g._sum.commission || 0) * 100) / 100,
    }));

    const commissionKept = commissionAgg._sum.amount || 0;
    const packageIncome = packageFeeAgg._sum.amount || 0;
    const referralPaid = referralAgg._sum.amount || 0;
    const companyNetPassive = Math.round((commissionKept - referralPaid + packageIncome) * 100) / 100;
    const payoutPending =
      Math.round(((pendingPayouts._sum.amount || 0) - (releasedAgg._sum.amount || 0)) * 100) /
      100;

    const incomeMix = [
      { label: "Job commission", amount: Math.round(commissionKept * 100) / 100 },
      { label: "Package fees", amount: Math.round(packageIncome * 100) / 100 },
      { label: "Referral paid out", amount: Math.round(referralPaid * 100) / 100 },
    ];

    return {
      jobsToday,
      city: "Global",
      commissionKeptPkr: Math.round(commissionKept),
      packageIncomePkr: Math.round(packageIncome),
      referralPaidPkr: Math.round(referralPaid),
      companyNetPassivePkr: Math.round(companyNetPassive),
      payoutPendingPkr: Math.max(0, Math.round(payoutPending)),
      experts,
      onlineExperts,
      shops,
      liveShops,
      heldShops,
      openJobs,
      inProgressJobs,
      receiptsToday,
      packages,
      jobsSeries,
      jobStatusMix,
      railMix,
      incomeMix,
      rates: { FREE: 12, SILVER: 9, GOLD: 6, PLATINUM: 2 },
      note: `Passive income = package fees + job commission − referral share. Payout queue ${Math.max(0, Math.round(payoutPending)).toLocaleString()}.`,
    };
  },

  async experts(
    page = 1,
    pageSize = 20,
    filters: { q?: string; package?: PackageTier; online?: boolean } = {},
  ) {
    const where: Record<string, unknown> = { seat: Seat.EXPERT };
    if (filters.package) where.package = filters.package;
    if (typeof filters.online === "boolean") where.isOnline = filters.online;
    if (filters.q?.trim()) {
      const q = filters.q.trim();
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { placeLabel: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { work: { contains: q, mode: "insensitive" } },
      ];
    }
    const [total, experts] = await Promise.all([
      prisma.account.count({ where }),
      prisma.account.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          work: true,
          placeLabel: true,
          city: true,
          package: true,
          rating: true,
          ratingCount: true,
          photoUrl: true,
          isOnline: true,
          latitude: true,
          longitude: true,
          payoutAccountSet: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, experts };
  },

  async shops(
    page = 1,
    pageSize = 20,
    filters: { q?: string; status?: ShopStatus } = {},
  ) {
    const where: Record<string, unknown> = {};
    if (filters.status) where.status = filters.status;
    if (filters.q?.trim()) {
      const q = filters.q.trim();
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { owner: { name: { contains: q, mode: "insensitive" } } },
      ];
    }
    const [total, shops] = await Promise.all([
      prisma.shop.count({ where }),
      prisma.shop.findMany({
        where,
        include: {
          owner: { select: { id: true, name: true, email: true } },
        },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, shops };
  },

  async jobs(
    page = 1,
    pageSize = 20,
    filters: { status?: JobStatus; q?: string } = {},
  ) {
    const where: Record<string, unknown> = {};
    if (filters.status) where.status = filters.status;
    if (filters.q?.trim()) {
      const q = filters.q.trim();
      where.OR = [
        { asker: { name: { contains: q, mode: "insensitive" } } },
        { worker: { name: { contains: q, mode: "insensitive" } } },
        { id: { contains: q } },
      ];
    }
    const [total, jobs] = await Promise.all([
      prisma.job.count({ where }),
      prisma.job.findMany({
        where,
        include: {
          asker: { select: { id: true, name: true } },
          worker: { select: { id: true, name: true, package: true } },
          receipt: true,
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, jobs };
  },

  async ledger(
    page = 1,
    pageSize = 25,
    filters: { kind?: LedgerKind; rail?: PaymentRail; q?: string } = {},
  ) {
    const where: Record<string, unknown> = {};
    if (filters.kind) where.kind = filters.kind;
    if (filters.rail) where.rail = filters.rail;
    if (filters.q?.trim()) {
      where.OR = [
        { note: { contains: filters.q.trim(), mode: "insensitive" } },
        { account: { name: { contains: filters.q.trim(), mode: "insensitive" } } },
      ];
    }
    const [total, lines] = await Promise.all([
      prisma.ledgerLine.count({ where }),
      prisma.ledgerLine.findMany({
        where,
        include: {
          account: { select: { id: true, name: true, email: true } },
          job: {
            select: {
              id: true,
              asker: { select: { name: true } },
              worker: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, lines };
  },

  async receipts(page = 1, pageSize = 20, q?: string) {
    const where = q?.trim()
      ? {
          OR: [
            { receiptNo: { contains: q.trim(), mode: "insensitive" as const } },
            { askerName: { contains: q.trim(), mode: "insensitive" as const } },
            { workerName: { contains: q.trim(), mode: "insensitive" as const } },
          ],
        }
      : {};
    const [total, receipts] = await Promise.all([
      prisma.paymentReceipt.count({ where }),
      prisma.paymentReceipt.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, receipts };
  },

  async activity() {
    const [jobs, lines, receipts, shops, notifications, contactRows] = await Promise.all([
      prisma.job.findMany({
        take: 8,
        orderBy: { updatedAt: "desc" },
        include: {
          asker: { select: { name: true } },
          worker: { select: { name: true } },
        },
      }),
      prisma.ledgerLine.findMany({
        take: 8,
        orderBy: { createdAt: "desc" },
        include: { account: { select: { name: true } } },
      }),
      prisma.paymentReceipt.findMany({ take: 5, orderBy: { createdAt: "desc" } }),
      prisma.shop.findMany({
        take: 5,
        orderBy: { updatedAt: "desc" },
        include: { owner: { select: { name: true } } },
      }),
      prisma.notification.findMany({
        take: 8,
        orderBy: { createdAt: "desc" },
        include: { account: { select: { name: true } } },
      }),
      prisma.contactInquiry.findMany({
        take: 12,
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const contacts = contactRows.map((n) => ({
      id: n.id,
      kind: n.kind,
      status: n.status,
      title: `${n.kind === "COMPLAINT" ? "Complaint" : "Contact"} · ${n.name}`,
      body: n.message.slice(0, 200),
      createdAt: n.createdAt,
      email: n.email,
      name: n.name,
      city: n.city,
      message: n.message,
      deskInbox: DESK_ADMIN_EMAIL,
    }));

    return { jobs, lines, receipts, shops, notifications, contacts };
  },

  async contacts(
    page = 1,
    pageSize = 30,
    filters: { kind?: "CONTACT" | "COMPLAINT" | "ALL"; status?: string; q?: string } = {},
  ) {
    const where: {
      kind?: "CONTACT" | "COMPLAINT";
      status?: "OPEN" | "READ" | "IN_PROGRESS" | "CLOSED";
      OR?: Array<Record<string, unknown>>;
    } = {};
    if (filters.kind && filters.kind !== "ALL") where.kind = filters.kind;
    if (
      filters.status === "OPEN" ||
      filters.status === "READ" ||
      filters.status === "IN_PROGRESS" ||
      filters.status === "CLOSED"
    ) {
      where.status = filters.status;
    }
    if (filters.q?.trim()) {
      const q = filters.q.trim();
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { subject: { contains: q, mode: "insensitive" } },
        { message: { contains: q, mode: "insensitive" } },
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.contactInquiry.count({ where }),
      prisma.contactInquiry.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const contacts = rows.map((n) => ({
      id: n.id,
      kind: n.kind,
      status: n.status,
      title: `${n.kind === "COMPLAINT" ? "Complaint" : "Contact"} · ${n.name}`,
      body: n.message.slice(0, 280),
      createdAt: n.createdAt,
      email: n.email,
      name: n.name,
      city: n.city,
      country: n.country,
      subject: n.subject,
      message: n.message,
      deskNote: n.deskNote,
      deskInbox: DESK_ADMIN_EMAIL,
      readAt: n.readAt,
      closedAt: n.closedAt,
      preview: n.message.length > 180 ? `${n.message.slice(0, 180)}…` : n.message,
    }));
    return { total, page, pageSize, contacts };
  },

  async contactById(id: string) {
    const n = await prisma.contactInquiry.findUnique({ where: { id } });
    if (!n) throw new AppError("Contact / complaint not found", 404, "NOT_FOUND");
    return {
      id: n.id,
      kind: n.kind,
      status: n.status,
      title: `${n.kind === "COMPLAINT" ? "Complaint" : "Contact"} · ${n.name}`,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      email: n.email,
      name: n.name,
      city: n.city,
      country: n.country,
      subject: n.subject,
      message: n.message,
      deskNote: n.deskNote,
      deskInbox: DESK_ADMIN_EMAIL,
      readAt: n.readAt,
      closedAt: n.closedAt,
    };
  },

  async updateContact(
    id: string,
    input: { status?: "OPEN" | "READ" | "IN_PROGRESS" | "CLOSED"; deskNote?: string },
  ) {
    const existing = await prisma.contactInquiry.findUnique({ where: { id } });
    if (!existing) throw new AppError("Contact / complaint not found", 404, "NOT_FOUND");

    const status = input.status || existing.status;

    let readAt: Date | null = existing.readAt;
    if (status === "OPEN") {
      readAt = null;
    } else if (!readAt) {
      readAt = new Date();
    }

    const closedAt =
      status === "CLOSED" ? existing.closedAt || new Date() : null;

    const updated = await prisma.contactInquiry.update({
      where: { id },
      data: {
        status,
        deskNote: input.deskNote !== undefined ? input.deskNote : existing.deskNote,
        readAt,
        closedAt,
      },
    });
    return this.contactById(updated.id);
  },

  async releasePayout(accountId: string, amount: number, note?: string) {
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.seat !== Seat.EXPERT) {
      throw new AppError("Expert not found", 404, "NOT_FOUND");
    }
    const [net, referral, released] = await Promise.all([
      prisma.ledgerLine.aggregate({
        where: { accountId, kind: LedgerKind.NET_PAYOUT },
        _sum: { amount: true },
      }),
      prisma.ledgerLine.aggregate({
        where: { accountId, kind: LedgerKind.REFERRAL_SHARE },
        _sum: { amount: true },
      }),
      prisma.ledgerLine.aggregate({
        where: { accountId, kind: LedgerKind.PAYOUT_RELEASE },
        _sum: { amount: true },
      }),
    ]);
    const available =
      (net._sum.amount || 0) + (referral._sum.amount || 0) - (released._sum.amount || 0);
    if (amount <= 0 || amount > available + 0.001) {
      throw new AppError(
        `Amount exceeds available PKR ${available.toFixed(2)}`,
        400,
        "INSUFFICIENT",
      );
    }
    const line = await prisma.ledgerLine.create({
      data: {
        accountId,
        kind: LedgerKind.PAYOUT_RELEASE,
        rail: account.payoutRail && account.payoutRail !== PaymentRail.CASH
          ? account.payoutRail
          : PaymentRail.JAZZCASH,
        amount,
        currency: account.currency,
        note: note || "Desk released payout",
      },
    });
    await prisma.notification.create({
      data: {
        accountId,
        kind: "SYSTEM",
        title: "Payout released",
        body: `${account.currency} ${amount.toLocaleString()} released by desk`,
        data: { ledgerLineId: line.id },
      },
    });
    return { line, availableAfter: Math.round((available - amount) * 100) / 100 };
  },

  async holdShop(shopId: string, reason = "Held by desk") {
    return prisma.shop.update({
      where: { id: shopId },
      data: { status: ShopStatus.HELD, heldReason: reason },
    });
  },

  async releaseShop(shopId: string) {
    const shop = await prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop) throw new AppError("Shop not found", 404, "NOT_FOUND");
    const canLive = shop.latitude != null && shop.longitude != null && Boolean(shop.doorPhotoUrl);
    return prisma.shop.update({
      where: { id: shopId },
      data: canLive
        ? { status: ShopStatus.LIVE, heldReason: null }
        : { status: ShopStatus.HELD, heldReason: "Pin or door photo still missing" },
    });
  },
};
