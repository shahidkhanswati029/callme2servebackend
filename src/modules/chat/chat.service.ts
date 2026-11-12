import { MessageKind, Seat } from "@prisma/client";
import { prisma } from "../../shared/db/prisma";
import { AppError } from "../../shared/errors/AppError";
import { presence } from "../../shared/presence";

function pairIds(a: string, b: string) {
  return a < b ? ([a, b] as const) : ([b, a] as const);
}

export const chatService = {
  async listConversations(accountId: string) {
    const rows = await prisma.conversation.findMany({
      where: {
        OR: [{ participantAId: accountId }, { participantBId: accountId }],
      },
      include: {
        participantA: {
          select: { id: true, name: true, photoUrl: true, work: true, placeLabel: true, isOnline: true, lastSeenAt: true },
        },
        participantB: {
          select: { id: true, name: true, photoUrl: true, work: true, placeLabel: true, isOnline: true, lastSeenAt: true },
        },
        messages: {
          where: {
            deletedAt: null,
            hides: { none: { accountId } },
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { lastMessageAt: "desc" },
    });

    return rows.map((c) => {
      const other =
        c.participantAId === accountId ? c.participantB : c.participantA;
      const live = presence.isOnline(other.id);
      const last = c.messages[0] || null;
      return {
        id: c.id,
        other: {
          id: other.id,
          name: other.name,
          photoUrl: other.photoUrl,
          work: other.work,
          placeLabel: other.placeLabel,
          lastSeenAt: other.lastSeenAt,
          // Socket presence only — DB isOnline can stay stale after crashes.
          isOnline: live,
        },
        lastMessage: last ? this.toPublicMessage(last) : null,
        lastMessageAt: c.lastMessageAt,
      };
    });
  },

  async getOtherProfile(accountId: string, otherId: string) {
    const other = await prisma.account.findUnique({
      where: { id: otherId },
      select: {
        id: true,
        name: true,
        photoUrl: true,
        work: true,
        placeLabel: true,
        isOnline: true,
        lastSeenAt: true,
        rating: true,
        ratingCount: true,
        seat: true,
      },
    });
    if (!other || other.seat !== Seat.EXPERT) {
      throw new AppError("Expert not found", 404, "NOT_FOUND");
    }
    if (other.id === accountId) {
      throw new AppError("Cannot chat with yourself", 400, "INVALID");
    }
    const live = presence.isOnline(other.id);
    return {
      id: other.id,
      name: other.name,
      photoUrl: other.photoUrl,
      work: other.work,
      placeLabel: other.placeLabel,
      lastSeenAt: other.lastSeenAt,
      rating: other.rating,
      ratingCount: other.ratingCount,
      isOnline: live,
    };
  },

  async getOrCreateDirect(accountId: string, otherId: string) {
    if (accountId === otherId) {
      throw new AppError("Cannot chat with yourself", 400, "INVALID");
    }
    const other = await prisma.account.findUnique({ where: { id: otherId } });
    if (!other || other.seat !== Seat.EXPERT) {
      throw new AppError("Expert not found", 404, "NOT_FOUND");
    }
    const [a, b] = pairIds(accountId, otherId);
    return prisma.conversation.upsert({
      where: {
        participantAId_participantBId: { participantAId: a, participantBId: b },
      },
      create: { participantAId: a, participantBId: b },
      update: {},
    });
  },

  async listMessages(accountId: string, conversationId: string, take = 50) {
    const c = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!c || (c.participantAId !== accountId && c.participantBId !== accountId)) {
      throw new AppError("Conversation not found", 404, "NOT_FOUND");
    }
    const messages = await prisma.message.findMany({
      where: {
        conversationId,
        hides: { none: { accountId } },
      },
      orderBy: { createdAt: "asc" },
      take,
    });
    return messages.map((m) => this.toPublicMessage(m));
  },

  /** Mark every message from the other person as read. Returns updated ids for socket. */
  async markRead(accountId: string, conversationId: string) {
    const c = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!c || (c.participantAId !== accountId && c.participantBId !== accountId)) {
      throw new AppError("Conversation not found", 404, "NOT_FOUND");
    }
    const now = new Date();
    const unread = await prisma.message.findMany({
      where: {
        conversationId,
        senderId: { not: accountId },
        readAt: null,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (unread.length === 0) {
      return {
        conversationId,
        messageIds: [] as string[],
        readAt: now,
        recipientId:
          c.participantAId === accountId ? c.participantBId : c.participantAId,
      };
    }
    await prisma.message.updateMany({
      where: { id: { in: unread.map((m) => m.id) } },
      data: { readAt: now },
    });
    return {
      conversationId,
      messageIds: unread.map((m) => m.id),
      readAt: now,
      recipientId:
        c.participantAId === accountId ? c.participantBId : c.participantAId,
    };
  },

  async sendMessage(
    accountId: string,
    input: {
      conversationId?: string;
      toAccountId?: string;
      kind: MessageKind;
      body?: string;
      mediaUrl?: string;
      mediaDurationS?: number;
    },
  ) {
    let conversationId = input.conversationId;
    if (!conversationId) {
      if (!input.toAccountId) {
        throw new AppError("conversationId or toAccountId required", 400, "INVALID");
      }
      const conv = await this.getOrCreateDirect(accountId, input.toAccountId);
      conversationId = conv.id;
    }

    const c = await prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!c || (c.participantAId !== accountId && c.participantBId !== accountId)) {
      throw new AppError("Conversation not found", 404, "NOT_FOUND");
    }

    if (input.kind === MessageKind.TEXT && !input.body?.trim()) {
      throw new AppError("Message body required", 400, "INVALID");
    }
    if (
      (input.kind === MessageKind.IMAGE ||
        input.kind === MessageKind.VIDEO ||
        input.kind === MessageKind.VOICE) &&
      !input.mediaUrl
    ) {
      throw new AppError("Media URL required", 400, "INVALID");
    }
    if (input.kind === MessageKind.VIDEO && (input.mediaDurationS || 0) > 30.05) {
      throw new AppError("Video stops at 30 seconds", 400, "VIDEO_CAP");
    }

    // Per conversation: max 5 images and 3 videos from each expert (deleted do not count).
    if (input.kind === MessageKind.IMAGE || input.kind === MessageKind.VIDEO) {
      const sent = await prisma.message.count({
        where: {
          conversationId,
          senderId: accountId,
          kind: input.kind,
          deletedAt: null,
        },
      });
      const limit = input.kind === MessageKind.IMAGE ? 5 : 3;
      if (sent >= limit) {
        throw new AppError(
          input.kind === MessageKind.IMAGE
            ? "You can send at most 5 images in this chat"
            : "You can send at most 3 videos in this chat",
          400,
          "MEDIA_LIMIT",
        );
      }
    }

    const message = await prisma.message.create({
      data: {
        conversationId,
        senderId: accountId,
        kind: input.kind,
        body: input.body,
        mediaUrl: input.mediaUrl,
        mediaDurationS: input.mediaDurationS,
      },
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    });

    const recipientId =
      c.participantAId === accountId ? c.participantBId : c.participantAId;

    const sender = await prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, name: true, photoUrl: true },
    });

    const mediaLabel =
      input.kind === MessageKind.IMAGE
        ? "sent a photo"
        : input.kind === MessageKind.VIDEO
          ? "sent a video"
          : input.kind === MessageKind.VOICE
            ? "sent a voice note"
            : (input.body || "").slice(0, 120) || "sent a message";

    await prisma.notification.create({
      data: {
        accountId: recipientId,
        kind: "CHAT",
        title: sender?.name || "New message",
        body: mediaLabel,
        data: {
          conversationId,
          messageId: message.id,
          kind: input.kind,
          actorId: accountId,
          actorName: sender?.name || "Expert",
          actorPhotoUrl: sender?.photoUrl || null,
          otherId: accountId,
        },
      },
    });

    return {
      message: this.toPublicMessage(message),
      recipientId,
      conversationId,
    };
  },

  /**
   * Delete for everyone (sender only) or delete for me (anyone in the thread, including receiver).
   */
  async deleteMessage(
    accountId: string,
    messageId: string,
    scope: "everyone" | "me" = "everyone",
  ) {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: true },
    });
    if (!message) throw new AppError("Message not found", 404, "NOT_FOUND");

    const c = message.conversation;
    if (c.participantAId !== accountId && c.participantBId !== accountId) {
      throw new AppError("Conversation not found", 404, "NOT_FOUND");
    }

    const recipientId =
      c.participantAId === accountId ? c.participantBId : c.participantAId;

    if (scope === "me") {
      await prisma.messageHide.upsert({
        where: {
          messageId_accountId: { messageId, accountId },
        },
        create: { messageId, accountId },
        update: {},
      });
      return {
        scope: "me" as const,
        message: this.toPublicMessage(message),
        recipientId,
        conversationId: message.conversationId,
        hiddenFor: accountId,
      };
    }

    if (message.senderId !== accountId) {
      throw new AppError(
        "Only the sender can delete for everyone. Use delete for me instead.",
        403,
        "NOT_SENDER",
      );
    }
    if (message.deletedAt) {
      return {
        scope: "everyone" as const,
        message: this.toPublicMessage(message),
        recipientId,
        conversationId: message.conversationId,
      };
    }

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: {
        deletedAt: new Date(),
        body: null,
        mediaUrl: null,
        mediaDurationS: null,
      },
    });

    const last = await prisma.message.findFirst({
      where: {
        conversationId: message.conversationId,
        deletedAt: null,
        hides: { none: { accountId } },
      },
      orderBy: { createdAt: "desc" },
    });
    await prisma.conversation.update({
      where: { id: message.conversationId },
      data: { lastMessageAt: last?.createdAt || message.createdAt },
    });

    return {
      scope: "everyone" as const,
      message: this.toPublicMessage(updated),
      recipientId,
      conversationId: message.conversationId,
    };
  },

  toPublicMessage(message: {
    id: string;
    conversationId: string;
    senderId: string;
    kind: MessageKind;
    body: string | null;
    mediaUrl: string | null;
    mediaDurationS: number | null;
    createdAt: Date;
    readAt?: Date | null;
    deletedAt: Date | null;
  }) {
    const deleted = Boolean(message.deletedAt);
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      kind: message.kind,
      body: deleted ? null : message.body,
      mediaUrl: deleted ? null : message.mediaUrl,
      mediaDurationS: deleted ? null : message.mediaDurationS,
      createdAt: message.createdAt,
      readAt: message.readAt ?? null,
      deletedAt: message.deletedAt,
      deleted,
    };
  },
};
