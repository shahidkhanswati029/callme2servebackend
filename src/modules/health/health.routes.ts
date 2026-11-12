import { Router } from "express";
import { prisma } from "../../shared/db/prisma";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  let database: "up" | "down" = "down";
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = "up";
  } catch {
    database = "down";
  }

  res.status(database === "up" ? 200 : 503).json({
    success: database === "up",
    data: {
      service: "callmetoserve-api",
      status: database === "up" ? "ok" : "degraded",
      database,
      timestamp: new Date().toISOString(),
    },
  });
});
