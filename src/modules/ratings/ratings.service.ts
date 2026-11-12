import { Seat } from "@prisma/client";
import { prisma } from "../../shared/db/prisma";
import { AppError } from "../../shared/errors/AppError";

export const ratingsService = {
  async upsert(
    fromId: string,
    input: { toAccountId: string; stars: number; text?: string; jobId?: string },
  ) {
    if (fromId === input.toAccountId) {
      throw new AppError("You cannot rate yourself", 400, "INVALID");
    }
    if (!Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5) {
      throw new AppError("Stars must be 1 to 5", 400, "INVALID");
    }

    const target = await prisma.account.findUnique({
      where: { id: input.toAccountId },
      select: { id: true, seat: true },
    });
    if (!target || target.seat !== Seat.EXPERT) {
      throw new AppError("Expert not found", 404, "NOT_FOUND");
    }

    if (input.jobId) {
      const job = await prisma.job.findUnique({ where: { id: input.jobId } });
      if (
        !job ||
        job.askerId !== fromId ||
        job.workerId !== input.toAccountId ||
        job.status !== "COMPLETED"
      ) {
        throw new AppError(
          "Rate only after this job is completed, as the asker rating the worker",
          400,
          "INVALID_JOB",
        );
      }
    } else {
      // Without a job id, only allow rating if the pair already completed a job together.
      const done = await prisma.job.findFirst({
        where: {
          askerId: fromId,
          workerId: input.toAccountId,
          status: "COMPLETED",
        },
      });
      if (!done) {
        throw new AppError(
          "Complete a job with this expert before rating",
          400,
          "JOB_REQUIRED",
        );
      }
      input.jobId = done.id;
    }

    await prisma.rating.upsert({
      where: {
        fromId_toId: { fromId, toId: input.toAccountId },
      },
      create: {
        fromId,
        toId: input.toAccountId,
        stars: input.stars,
        text: input.text?.trim() || null,
        jobId: input.jobId || null,
      },
      update: {
        stars: input.stars,
        text: input.text?.trim() || null,
        jobId: input.jobId || null,
      },
    });

    const agg = await prisma.rating.aggregate({
      where: { toId: input.toAccountId },
      _avg: { stars: true },
      _count: { _all: true },
    });

    const account = await prisma.account.update({
      where: { id: input.toAccountId },
      data: {
        rating: Number((agg._avg.stars || 0).toFixed(2)),
        ratingCount: agg._count._all,
      },
      select: {
        id: true,
        name: true,
        rating: true,
        ratingCount: true,
      },
    });

    const mine = await prisma.rating.findUnique({
      where: { fromId_toId: { fromId, toId: input.toAccountId } },
    });

    return { account, mine };
  },

  async getForExpert(viewerId: string, expertId: string) {
    const expert = await prisma.account.findUnique({
      where: { id: expertId },
      select: {
        id: true,
        name: true,
        rating: true,
        ratingCount: true,
        seat: true,
      },
    });
    if (!expert || expert.seat !== Seat.EXPERT) {
      throw new AppError("Expert not found", 404, "NOT_FOUND");
    }
    const mine = await prisma.rating.findUnique({
      where: { fromId_toId: { fromId: viewerId, toId: expertId } },
    });
    return {
      expert: {
        id: expert.id,
        name: expert.name,
        rating: expert.rating,
        ratingCount: expert.ratingCount,
      },
      mine: mine
        ? {
            stars: mine.stars,
            text: mine.text,
            updatedAt: mine.updatedAt,
          }
        : null,
    };
  },
};
