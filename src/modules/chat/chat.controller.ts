import type { NextFunction, Response } from "express";
import { MessageKind } from "@prisma/client";
import { z } from "zod";
import type { AuthenticatedRequest } from "../identity/identity.middleware";
import { chatService } from "./chat.service";

const sendSchema = z.object({
  conversationId: z.string().optional(),
  toAccountId: z.string().optional(),
  kind: z.nativeEnum(MessageKind).default(MessageKind.TEXT),
  body: z.string().max(4000).optional(),
  mediaUrl: z.string().url().optional(),
  // Voice has no 30s cap; video is enforced in chatService.
  mediaDurationS: z.number().min(0).max(3600).optional(),
});

export const chatController = {
  async list(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const conversations = await chatService.listConversations(req.auth!.sub);
      res.json({ success: true, data: { conversations } });
    } catch (err) {
      next(err);
    }
  },

  async open(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const otherId = String(req.params.otherId);
      const other = await chatService.getOtherProfile(req.auth!.sub, otherId);
      const conversation = await chatService.getOrCreateDirect(req.auth!.sub, otherId);
      const read = await chatService.markRead(req.auth!.sub, conversation.id);
      const messages = await chatService.listMessages(req.auth!.sub, conversation.id);
      const io = req.app.get("io");
      if (io && read.messageIds.length > 0) {
        io.to(`user:${read.recipientId}`).emit("message:read", {
          conversationId: read.conversationId,
          messageIds: read.messageIds,
          readAt: read.readAt,
        });
      }
      res.json({
        success: true,
        data: { conversation, messages, other },
      });
    } catch (err) {
      next(err);
    }
  },

  async markRead(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const read = await chatService.markRead(req.auth!.sub, id);
      const io = req.app.get("io");
      if (io && read.messageIds.length > 0) {
        io.to(`user:${read.recipientId}`).emit("message:read", {
          conversationId: read.conversationId,
          messageIds: read.messageIds,
          readAt: read.readAt,
        });
      }
      res.json({
        success: true,
        data: {
          conversationId: read.conversationId,
          messageIds: read.messageIds,
          readAt: read.readAt,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async messages(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const messages = await chatService.listMessages(req.auth!.sub, id);
      res.json({ success: true, data: { messages } });
    } catch (err) {
      next(err);
    }
  },

  async send(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const body = sendSchema.parse(req.body);
      const result = await chatService.sendMessage(req.auth!.sub, body);
      const io = req.app.get("io");
      if (io) {
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
      }
      res.status(201).json({
        success: true,
        message: "Message sent",
        data: { message: result.message, conversationId: result.conversationId },
      });
    } catch (err) {
      next(err);
    }
  },

  async remove(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const messageId = String(req.params.id);
      const scope =
        req.query.scope === "me" || req.body?.scope === "me" ? "me" : "everyone";
      const result = await chatService.deleteMessage(req.auth!.sub, messageId, scope);
      const io = req.app.get("io");
      if (io) {
        if (result.scope === "everyone") {
          const payload = {
            conversationId: result.conversationId,
            message: result.message,
            scope: "everyone",
          };
          io.to(`user:${result.recipientId}`).emit("message:deleted", payload);
          io.to(`user:${req.auth!.sub}`).emit("message:deleted", payload);
        } else {
          io.to(`user:${req.auth!.sub}`).emit("message:hidden", {
            conversationId: result.conversationId,
            messageId: result.message.id,
            scope: "me",
          });
        }
      }
      res.json({
        success: true,
        message: result.scope === "me" ? "Deleted for you" : "Deleted for everyone",
        data: {
          message: result.message,
          conversationId: result.conversationId,
          scope: result.scope,
        },
      });
    } catch (err) {
      next(err);
    }
  },
};
