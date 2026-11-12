import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env";
import { healthRouter } from "./modules/health/health.routes";
import { identityRouter } from "./modules/identity/identity.routes";
import { locationRouter } from "./modules/location/location.routes";
import { shopsRouter } from "./modules/shops/shops.routes";
import { chatRouter } from "./modules/chat/chat.routes";
import { notificationsRouter } from "./modules/notifications/notifications.routes";
import { mediaRouter } from "./modules/media/media.routes";
import { deskRouter } from "./modules/desk/desk.routes";
import { referrerRouter } from "./modules/referrer/referrer.routes";
import { paymentsRouter } from "./modules/payments/payments.routes";
import { languageRouter } from "./modules/language/language.routes";
import { ratingsRouter } from "./modules/ratings/ratings.routes";
import { jobsRouter } from "./modules/jobs/jobs.routes";
import { publicRouter } from "./modules/public/public.routes";
import { errorHandler } from "./shared/middleware/errorHandler";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || env.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`CORS blocked origin: ${origin}`));
      },
      credentials: true,
    }),
  );
  // Keep JSON small on most routes; media uploads use multipart, not this parser.
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.use("/api/health", healthRouter);
  app.use("/api/public", publicRouter);
  app.use("/api/identity", identityRouter);
  app.use("/api/location", locationRouter);
  app.use("/api/shops", shopsRouter);
  app.use("/api/chat", chatRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/media", mediaRouter);
  app.use("/api/desk", deskRouter);
  app.use("/api/referrer", referrerRouter);
  app.use("/api/payments", paymentsRouter);
  app.use("/api/language", languageRouter);
  app.use("/api/ratings", ratingsRouter);
  app.use("/api/jobs", jobsRouter);

  app.use(errorHandler);
  return app;
}
