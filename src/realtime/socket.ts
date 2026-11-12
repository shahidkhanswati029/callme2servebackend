import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { env } from "../config/env";
import { verifyAccessToken } from "../shared/utils/tokens";
import { prisma } from "../shared/db/prisma";
import { presence } from "../shared/presence";
import { chatService } from "../modules/chat/chat.service";
import { MessageKind } from "@prisma/client";

export function attachSocket(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: env.corsOrigins,
      credentials: true,
    },
  });

  io.use((socket, next) => {
    try {
      const token =
        (socket.handshake.auth?.token as string) ||
        (socket.handshake.headers.authorization || "").replace("Bearer ", "");
      if (!token) return next(new Error("UNAUTHORIZED"));
      const payload = verifyAccessToken(token);
      socket.data.accountId = payload.sub;
      next();
    } catch {
      next(new Error("UNAUTHORIZED"));
    }
  });

  io.on("connection", async (socket) => {
    const accountId = socket.data.accountId as string;
    socket.join(`user:${accountId}`);
    presence.add(accountId, socket.id);
    const onlineAt = new Date();
    await prisma.account.update({
      where: { id: accountId },
      data: { isOnline: true, lastSeenAt: onlineAt },
    });
    io.emit("presence:update", {
      accountId,
      isOnline: true,
      lastSeenAt: onlineAt.toISOString(),
    });

    socket.on("message:send", async (payload, ack) => {
      try {
        const result = await chatService.sendMessage(accountId, {
          conversationId: payload.conversationId,
          toAccountId: payload.toAccountId,
          kind: (payload.kind as MessageKind) || MessageKind.TEXT,
          body: payload.body,
          mediaUrl: payload.mediaUrl,
          mediaDurationS: payload.mediaDurationS,
        });
        io.to(`user:${result.recipientId}`).emit("message:new", {
          conversationId: result.conversationId,
          message: result.message,
        });
        io.to(`user:${result.recipientId}`).emit("notification:new", {
          kind: "CHAT",
          title: "New message",
          body: result.message.body || result.message.kind,
          conversationId: result.conversationId,
        });
        socket.emit("message:new", {
          conversationId: result.conversationId,
          message: result.message,
        });
        if (typeof ack === "function") ack({ ok: true, message: result.message });
      } catch (err) {
        if (typeof ack === "function") {
          ack({
            ok: false,
            error: err instanceof Error ? err.message : "Send failed",
          });
        }
      }
    });

    socket.on("conversation:read", async (payload, ack) => {
      try {
        const conversationId = String(payload?.conversationId || "");
        if (!conversationId) throw new Error("conversationId required");
        const read = await chatService.markRead(accountId, conversationId);
        if (read.messageIds.length > 0) {
          io.to(`user:${read.recipientId}`).emit("message:read", {
            conversationId: read.conversationId,
            messageIds: read.messageIds,
            readAt: read.readAt,
          });
        }
        if (typeof ack === "function") ack({ ok: true, ...read });
      } catch (err) {
        if (typeof ack === "function") {
          ack({
            ok: false,
            error: err instanceof Error ? err.message : "Read failed",
          });
        }
      }
    });

    socket.on("disconnect", async () => {
      presence.remove(accountId, socket.id);
      const still = presence.isOnline(accountId);
      if (!still) {
        const lastSeenAt = new Date();
        await prisma.account.update({
          where: { id: accountId },
          data: { isOnline: false, lastSeenAt },
        });
        io.emit("presence:update", {
          accountId,
          isOnline: false,
          lastSeenAt: lastSeenAt.toISOString(),
        });
      }
    });
  });

  return io;
}
