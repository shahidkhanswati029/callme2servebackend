import { Router } from "express";
import { z } from "zod";
import { publicService } from "./public.service";

export const publicRouter = Router();

function shortCache(res: import("express").Response, seconds = 60) {
  res.setHeader("Cache-Control", `public, max-age=${seconds}, stale-while-revalidate=120`);
}

publicRouter.get("/overview", async (req, res, next) => {
  try {
    const country = req.query.country ? String(req.query.country) : undefined;
    const overview = await publicService.overview(country);
    shortCache(res, 60);
    res.json({ success: true, data: { overview } });
  } catch (err) {
    next(err);
  }
});

publicRouter.get("/search", async (req, res, next) => {
  try {
    const q = z
      .object({
        q: z.string().optional(),
        city: z.string().optional(),
        category: z.string().optional(),
        country: z.string().optional(),
        page: z.coerce.number().optional(),
        pageSize: z.coerce.number().optional(),
      })
      .parse(req.query);
    const data = await publicService.search(q);
    shortCache(res, 30);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

publicRouter.get("/cities", async (req, res, next) => {
  try {
    const country = req.query.country ? String(req.query.country) : "PK";
    const cities = await publicService.cities(country);
    shortCache(res, 60);
    res.json({ success: true, data: { cities, country: country.toUpperCase() } });
  } catch (err) {
    next(err);
  }
});

publicRouter.get("/categories", async (req, res, next) => {
  try {
    const country = req.query.country ? String(req.query.country) : undefined;
    const categories = await publicService.categories(country);
    shortCache(res, 60);
    res.json({ success: true, data: { categories } });
  } catch (err) {
    next(err);
  }
});

publicRouter.get("/reviews", async (req, res, next) => {
  try {
    const take = Math.min(20, Math.max(1, Number(req.query.take) || 8));
    const country = req.query.country ? String(req.query.country) : undefined;
    const reviews = await publicService.reviews(take, country);
    shortCache(res, 60);
    res.json({ success: true, data: { reviews } });
  } catch (err) {
    next(err);
  }
});

publicRouter.post("/contact", async (req, res, next) => {
  try {
    const body = z
      .object({
        name: z.string().trim().min(2).max(120),
        email: z.string().trim().email().max(160),
        message: z.string().trim().min(5).max(4000),
        city: z.string().trim().max(80).optional(),
        country: z.string().trim().max(8).optional(),
        subject: z.string().trim().max(160).optional(),
        kind: z.enum(["CONTACT", "COMPLAINT"]).optional(),
      })
      .parse(req.body);
    const data = await publicService.contact(body);
    res.status(201).json({ success: true, message: "Message sent to desk", data });
  } catch (err) {
    next(err);
  }
});
