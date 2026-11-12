import { Router } from "express";
import { requireAuth } from "../identity/identity.middleware";
import { chatController } from "./chat.controller";

export const chatRouter = Router();

chatRouter.get("/conversations", requireAuth, chatController.list);
chatRouter.post("/conversations/:otherId", requireAuth, chatController.open);
chatRouter.get("/conversations/:id/messages", requireAuth, chatController.messages);
chatRouter.post("/conversations/:id/read", requireAuth, chatController.markRead);
chatRouter.post("/messages", requireAuth, chatController.send);
chatRouter.delete("/messages/:id", requireAuth, chatController.remove);
