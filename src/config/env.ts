import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_EXPIRES_IN: z.string().default("7d"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  GOOGLE_CLIENT_ID: z.string().optional().default(""),
  FACEBOOK_APP_ID: z.string().optional().default(""),
  FACEBOOK_APP_SECRET: z.string().optional().default(""),
  WEBAUTHN_RP_ID: z.string().default("localhost"),
  WEBAUTHN_RP_NAME: z.string().default("CallMe2Serve"),
  DESK_ADMIN_EMAIL: z.string().email().default("maaali615@gmail.com"),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === "true"),

  /** sandbox = no real money (default). live = real provider adapters. */
  PAYMENTS_MODE: z.enum(["sandbox", "live"]).default("sandbox"),

  // JazzCash merchant (after JazzCash merchant approval)
  JAZZCASH_MERCHANT_ID: z.string().optional().default(""),
  JAZZCASH_PASSWORD: z.string().optional().default(""),
  JAZZCASH_INTEGRITY_SALT: z.string().optional().default(""),
  JAZZCASH_CHECKOUT_URL: z
    .string()
    .optional()
    .default("https://payments.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform"),

  // Easypaisa merchant
  EASYPAISA_STORE_ID: z.string().optional().default(""),
  EASYPAISA_HASH_KEY: z.string().optional().default(""),
  EASYPAISA_CHECKOUT_URL: z
    .string()
    .optional()
    .default("https://easypay.easypaisa.com.pk/easypay-v2/Index.jsf"),

  // Stripe (card + Google Pay)
  STRIPE_SECRET_KEY: z.string().optional().default(""),
  STRIPE_PUBLISHABLE_KEY: z.string().optional().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().optional().default(""),

  // PayPal
  PAYPAL_CLIENT_ID: z.string().optional().default(""),
  PAYPAL_CLIENT_SECRET: z.string().optional().default(""),
  PAYPAL_CHECKOUT_BASE: z.string().optional().default("https://www.paypal.com"),
  PAYPAL_MODE: z.enum(["sandbox", "live"]).optional().default("sandbox"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean),
};
