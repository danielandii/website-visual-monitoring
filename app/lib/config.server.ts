import "dotenv/config";
import { z } from "zod";
import { DEFAULT_DEFACEMENT_KEYWORDS, DEFAULT_GAMBLING_KEYWORDS, DEFAULT_SPAM_KEYWORDS } from "./compromise";

export const ConfigSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32).default("dev-session-secret-change-me-please-32"),
  ADMIN_USERNAME: z.string().default("admin"),
  ADMIN_PASSWORD_HASH: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  DISCORD_WEBHOOK_URL: z.string().url().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default("google/gemma-4-26b-a4b-it"),
  CHECK_CADENCE_MINUTES: z.coerce.number().int().positive().default(60),
  CHECK_STALE_CLAIM_SECONDS: z.coerce.number().int().positive().default(120),
  MAX_CONCURRENT_CHECKS: z.coerce.number().int().positive().default(5),
  NAVIGATION_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  TOTAL_CHECK_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  STABILIZATION_DELAY_MS: z.coerce.number().int().nonnegative().default(2_000),
  CONFIRMATION_RETRY_DELAY_MS: z.coerce.number().int().nonnegative().default(60_000),
  VIEWPORT_WIDTH: z.coerce.number().int().positive().default(390),
  VIEWPORT_HEIGHT: z.coerce.number().int().positive().default(844),
  DISCORD_ALERTS_PER_MINUTE: z.coerce.number().int().positive().default(5),
  COMPROMISE_DETECTION_ENABLED: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  COMPROMISE_SPAM_KEYWORDS: z.string().default(DEFAULT_SPAM_KEYWORDS.join("\n")),
  COMPROMISE_GAMBLING_KEYWORDS: z.string().default(DEFAULT_GAMBLING_KEYWORDS.join("\n")),
  COMPROMISE_DEFACEMENT_KEYWORDS: z.string().default(DEFAULT_DEFACEMENT_KEYWORDS.join("\n")),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

let config: AppConfig | undefined;

export function getConfig() {
  if (!config) {
    config = ConfigSchema.parse(process.env);
  }
  return config;
}
