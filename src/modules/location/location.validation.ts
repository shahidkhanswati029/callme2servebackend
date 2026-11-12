import { z } from "zod";

export const savePlaceSchema = z.object({
  placeLabel: z.string().trim().min(2).max(160),
  city: z.string().trim().min(2).max(80).optional(),
  country: z.string().trim().length(2).optional(),
  currency: z.string().trim().min(3).max(3).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(50000).optional(),
});

export const nearbyQuerySchema = z.object({
  km: z.coerce.number().min(0.1).max(50).default(5),
  category: z.string().trim().min(1).max(80).optional(),
  q: z.string().trim().min(1).max(80).optional(),
});
