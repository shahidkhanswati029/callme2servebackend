import { LedgerKind, Prisma } from "@prisma/client";
import { prisma } from "../../shared/db/prisma";
import { AppError } from "../../shared/errors/AppError";

function makeCode(name: string) {
  const base = name
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 6)
    .toUpperCase();
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${base || "EXP"}${suffix}`;
}

export const referrerService = {
  async ensureSettings() {
    return prisma.referralSettings.upsert({
      where: { id: "default" },
      create: { id: "default", sharePercent: 25, durationMonths: 6 },
      update: {},
    });
  },

  async ensureCode(accountId: string) {
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account) throw new AppError("Account not found", 404, "NOT_FOUND");
    if (account.referralCode) return account;
    for (let i = 0; i < 5; i++) {
      const code = makeCode(account.name);
      try {
        return await prisma.account.update({
          where: { id: accountId },
          data: { referralCode: code },
        });
      } catch {
        // collision — retry
      }
    }
    throw new AppError("Could not issue referral code", 500, "CODE_FAILED");
  },

  async attachOnSignup(newExpertId: string, code: string) {
    const settings = await this.ensureSettings();
    const referrer = await prisma.account.findFirst({
      where: { referralCode: code.trim().toUpperCase(), seat: "EXPERT" },
    });
    if (!referrer) throw new AppError("Referral code not found", 404, "CODE_MISSING");
    if (referrer.id === newExpertId) {
      throw new AppError("You cannot refer yourself", 400, "SELF_REFERRAL");
    }
    const existing = await prisma.referral.findUnique({ where: { expertId: newExpertId } });
    if (existing) return existing;

    const endsAt = new Date();
    endsAt.setMonth(endsAt.getMonth() + settings.durationMonths);

    const [referral] = await prisma.$transaction([
      prisma.referral.create({
        data: {
          referrerId: referrer.id,
          expertId: newExpertId,
          codeUsed: referrer.referralCode!,
          endsAt,
        },
      }),
      prisma.account.update({
        where: { id: newExpertId },
        data: {
          referredById: referrer.id,
          referralJoinedAt: new Date(),
        },
      }),
    ]);
    return referral;
  },

  async mine(accountId: string) {
    const account = await this.ensureCode(accountId);
    const settings = await this.ensureSettings();
    const referred = await prisma.referral.findMany({
      where: { referrerId: accountId },
      include: {
        expert: {
          select: { id: true, name: true, work: true, placeLabel: true, package: true },
        },
      },
      orderBy: { joinedAt: "desc" },
    });
    const balance = await prisma.ledgerLine.aggregate({
      where: { accountId, kind: LedgerKind.REFERRAL_SHARE },
      _sum: { amount: true },
    });
    return {
      code: account.referralCode,
      sharePercent: settings.sharePercent,
      durationMonths: settings.durationMonths,
      referredCount: referred.length,
      referralBalance: balance._sum.amount || 0,
      currency: account.currency,
      referred: referred.map((r) => ({
        id: r.expert.id,
        name: r.expert.name,
        work: r.expert.work,
        placeLabel: r.expert.placeLabel,
        package: r.expert.package,
        joinedAt: r.joinedAt,
        endsAt: r.endsAt,
        active: r.active && r.endsAt > new Date(),
      })),
    };
  },

  /** Credit referrer share after a completed job (company commission already known). */
  async creditFromCommission(
    workerId: string,
    jobId: string,
    companyCommission: number,
    currency: string,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx || prisma;
    const link = await db.referral.findUnique({ where: { expertId: workerId } });
    if (!link || !link.active || link.endsAt < new Date()) return null;
    const settings = await this.ensureSettings();
    const share = Math.round(((companyCommission * settings.sharePercent) / 100) * 100) / 100;
    if (share <= 0) return null;
    return db.ledgerLine.create({
      data: {
        accountId: link.referrerId,
        jobId,
        kind: LedgerKind.REFERRAL_SHARE,
        amount: share,
        currency,
        note: `Referral share ${settings.sharePercent}% of commission`,
      },
    });
  },
};
