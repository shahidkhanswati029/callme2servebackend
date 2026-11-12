import { Router } from "express";
import { JobStatus, LedgerKind, PackageTier, PaymentRail, Seat, ShopStatus } from "@prisma/client";
import { z } from "zod";
import { requireAuth, requireSeat, type AuthenticatedRequest } from "../identity/identity.middleware";
import { deskService } from "./desk.service";

export const deskRouter = Router();

deskRouter.use(requireAuth, requireSeat(Seat.DESK));

deskRouter.get("/board", async (_req, res, next) => {
  try {
    const board = await deskService.board();
    res.json({ success: true, data: { board } });
  } catch (err) {
    next(err);
  }
});

deskRouter.get("/activity", async (_req, res, next) => {
  try {
    const activity = await deskService.activity();
    res.json({ success: true, data: { activity } });
  } catch (err) {
    next(err);
  }
});

deskRouter.get("/contacts", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 30));
    const kindRaw = req.query.kind ? String(req.query.kind).toUpperCase() : "ALL";
    const kind =
      kindRaw === "CONTACT" || kindRaw === "COMPLAINT" || kindRaw === "ALL" ? kindRaw : "ALL";
    const data = await deskService.contacts(page, pageSize, {
      kind,
      status: req.query.status ? String(req.query.status).toUpperCase() : undefined,
      q: req.query.q ? String(req.query.q) : undefined,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

deskRouter.get("/contacts/:id", async (req, res, next) => {
  try {
    const contact = await deskService.contactById(String(req.params.id));
    res.json({ success: true, data: { contact } });
  } catch (err) {
    next(err);
  }
});

deskRouter.patch("/contacts/:id", async (req, res, next) => {
  try {
    const body = z
      .object({
        status: z.enum(["OPEN", "READ", "IN_PROGRESS", "CLOSED"]).optional(),
        deskNote: z.string().max(2000).optional(),
      })
      .parse(req.body);
    const contact = await deskService.updateContact(String(req.params.id), body);
    res.json({ success: true, message: "Contact updated", data: { contact } });
  } catch (err) {
    next(err);
  }
});

deskRouter.get("/experts", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 20));
    const pkg = req.query.package
      ? z.nativeEnum(PackageTier).parse(String(req.query.package))
      : undefined;
    const online =
      req.query.online === "true" ? true : req.query.online === "false" ? false : undefined;
    const data = await deskService.experts(page, pageSize, {
      q: req.query.q ? String(req.query.q) : undefined,
      package: pkg,
      online,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

deskRouter.get("/shops", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 20));
    const status = req.query.status
      ? z.nativeEnum(ShopStatus).parse(String(req.query.status))
      : undefined;
    const data = await deskService.shops(page, pageSize, {
      q: req.query.q ? String(req.query.q) : undefined,
      status,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

deskRouter.get("/jobs", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 20));
    const status = req.query.status
      ? z.nativeEnum(JobStatus).parse(String(req.query.status))
      : undefined;
    const data = await deskService.jobs(page, pageSize, {
      status,
      q: req.query.q ? String(req.query.q) : undefined,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

deskRouter.get("/ledger", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 25));
    const kind = req.query.kind
      ? z.nativeEnum(LedgerKind).parse(String(req.query.kind))
      : undefined;
    const rail = req.query.rail
      ? z.nativeEnum(PaymentRail).parse(String(req.query.rail))
      : undefined;
    const data = await deskService.ledger(page, pageSize, {
      kind,
      rail,
      q: req.query.q ? String(req.query.q) : undefined,
    });
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

deskRouter.get("/receipts", async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 20));
    const data = await deskService.receipts(
      page,
      pageSize,
      req.query.q ? String(req.query.q) : undefined,
    );
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

deskRouter.post("/payouts/release", async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = z
      .object({
        accountId: z.string().min(1),
        amount: z.number().positive(),
        note: z.string().max(200).optional(),
      })
      .parse(req.body);
    const data = await deskService.releasePayout(body.accountId, body.amount, body.note);
    res.json({ success: true, message: "Payout released", data });
  } catch (err) {
    next(err);
  }
});

deskRouter.post("/shops/:id/hold", async (req: AuthenticatedRequest, res, next) => {
  try {
    const shop = await deskService.holdShop(String(req.params.id), "Held by desk");
    res.json({ success: true, message: "Shop held", data: { shop } });
  } catch (err) {
    next(err);
  }
});

deskRouter.post("/shops/:id/release", async (req: AuthenticatedRequest, res, next) => {
  try {
    const shop = await deskService.releaseShop(String(req.params.id));
    res.json({ success: true, message: "Shop release checked", data: { shop } });
  } catch (err) {
    next(err);
  }
});
