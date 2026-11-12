import type { Account, Prisma, Seat } from "@prisma/client";
import { prisma } from "../../shared/db/prisma";

export const identityRepository = {
  findByEmail(email: string): Promise<Account | null> {
    return prisma.account.findUnique({ where: { email } });
  },

  findById(id: string): Promise<Account | null> {
    return prisma.account.findUnique({ where: { id } });
  },

  findByGoogleId(googleId: string): Promise<Account | null> {
    return prisma.account.findUnique({ where: { googleId } });
  },

  findByFacebookId(facebookId: string): Promise<Account | null> {
    return prisma.account.findUnique({ where: { facebookId } });
  },

  findByRefreshTokenHash(refreshTokenHash: string): Promise<Account | null> {
    return prisma.account.findFirst({ where: { refreshTokenHash } });
  },

  create(data: Prisma.AccountCreateInput): Promise<Account> {
    return prisma.account.create({ data });
  },

  update(id: string, data: Prisma.AccountUpdateInput): Promise<Account> {
    return prisma.account.update({ where: { id }, data });
  },

  clearRefreshToken(id: string): Promise<Account> {
    return prisma.account.update({
      where: { id },
      data: { refreshTokenHash: null },
    });
  },

  async ensureSeat(email: string, seat: Seat): Promise<Account | null> {
    const account = await this.findByEmail(email);
    if (!account) return null;
    if (account.seat !== seat) return null;
    return account;
  },
};
