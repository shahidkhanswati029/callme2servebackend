import { z } from "zod";

export const SHOP_TYPES = [
  "surgical",
  "leather",
  "institute",
  "factory",
  "tutor",
  "other",
] as const;

export const createShopSchema = z.object({
  type: z.enum(SHOP_TYPES),
  name: z.string().trim().min(2).max(120),
  typeFields: z.record(z.string(), z.string()).default({}),
  street: z.string().trim().max(200).optional(),
});

export const updateShopSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  typeFields: z.record(z.string(), z.string()).optional(),
  street: z.string().trim().max(200).optional().nullable(),
});

export const shopPinSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(50000).optional(),
});

export const doorPhotoSchema = z.object({
  doorPhotoUrl: z.string().trim().url().or(z.string().trim().min(4).max(500)),
});
