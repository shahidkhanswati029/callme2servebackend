import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(8).max(128),
  phone: z.string().trim().min(7).max(30).optional(),
  city: z.string().trim().min(2).max(80).optional(),
  work: z.string().trim().min(2).max(120).optional(),
  languages: z.array(z.string().trim().min(2).max(40)).max(10).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  password: z.string().min(1).max(128),
});

/** Desk seat sign-in — email only (password removed from product surfaces). */
export const deskLoginSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});

export const googleSchema = z.object({
  idToken: z.string().min(10),
  phone: z.string().trim().min(7).max(30).optional(),
  city: z.string().trim().min(2).max(80).optional(),
});

export const facebookSchema = z.object({
  accessToken: z.string().min(10),
  phone: z.string().trim().min(7).max(30).optional(),
  city: z.string().trim().min(2).max(80).optional(),
});

export const enrollBiometricsSchema = z.object({
  fingerprintEnrolled: z.boolean().optional(),
  faceEnrolled: z.boolean().optional(),
});

export const detailsSchema = z.object({
  work: z.string().trim().min(2).max(120),
  languages: z.array(z.string().trim().min(2).max(40)).max(10).default([]),
  city: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(7).max(30).optional(),
  placeLabel: z.string().trim().min(2).max(160).optional(),
});

export const webauthnDeviceSchema = z.object({
  deviceHint: z.enum(["fingerprint", "face"]).optional().default("fingerprint"),
  attestationResponse: z.any(),
});

export const webauthnAuthSchema = z.object({
  assertionResponse: z.any(),
});
