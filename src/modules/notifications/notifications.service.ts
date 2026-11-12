import { prisma } from "../../shared/db/prisma";

type NotifData = {
  actorId?: string;
  actorName?: string;
  actorPhotoUrl?: string | null;
  conversationId?: string;
  jobId?: string;
  messageId?: string;
  otherId?: string;
  [key: string]: unknown;
};

export const notificationsService = {
  async list(accountId: string, page = 1, pageSize = 20) {
    const where = { accountId };
    const [total, rows, unread] = await Promise.all([
      prisma.notification.count({ where }),
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.notification.count({ where: { accountId, readAt: null } }),
    ]);

    const actorIds = Array.from(
      new Set(
        rows
          .map((n) => (n.data as NotifData | null)?.actorId)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    const actors =
      actorIds.length > 0
        ? await prisma.account.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, name: true, photoUrl: true },
          })
        : [];
    const byId = new Map(actors.map((a) => [a.id, a]));

    const notifications = rows.map((n) => {
      const data = (n.data || {}) as NotifData;
      const live = data.actorId ? byId.get(data.actorId) : undefined;
      const actor = live
        ? { id: live.id, name: live.name, photoUrl: live.photoUrl }
        : data.actorId || data.actorName
          ? {
              id: data.actorId || "",
              name: data.actorName || "Someone",
              photoUrl: data.actorPhotoUrl || null,
            }
          : null;
      return {
        ...n,
        actor,
      };
    });

    return { total, page, pageSize, unread, notifications };
  },

  async markRead(accountId: string, id: string) {
    return prisma.notification.updateMany({
      where: { id, accountId },
      data: { readAt: new Date() },
    });
  },

  async markAllRead(accountId: string) {
    return prisma.notification.updateMany({
      where: { accountId, readAt: null },
      data: { readAt: new Date() },
    });
  },

  async savePushToken(accountId: string, token: string, language = "en") {
    return prisma.pushToken.upsert({
      where: { token },
      create: { accountId, token, language },
      update: { accountId, language },
    });
  },
};
