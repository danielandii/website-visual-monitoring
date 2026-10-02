import {
  bigint,
  boolean,
  char,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const latestStatusValues = ["UNKNOWN", "OK", "FAILING"] as const;
export const failureCategoryValues = [
  "DOWN",
  "BLANK",
  "ERROR_PAGE",
  "VISUAL_BROKEN",
  "BLOCKED",
] as const;

export type LatestStatus = (typeof latestStatusValues)[number];
export type FailureCategory = (typeof failureCategoryValues)[number];

export const monitoredUrls = mysqlTable(
  "monitored_urls",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    name: varchar("name", { length: 191 }).notNull(),
    url: text("url").notNull(),
    normalizedUrl: text("normalized_url").notNull(),
    normalizedUrlHash: char("normalized_url_hash", { length: 64 }).notNull(),
    enabled: boolean("enabled").notNull().default(true),

    nextCheckAt: timestamp("next_check_at").notNull().defaultNow(),
    checkClaimedAt: timestamp("check_claimed_at"),
    checkClaimedBy: varchar("check_claimed_by", { length: 191 }),

    latestStatus: mysqlEnum("latest_status", latestStatusValues).notNull().default("UNKNOWN"),
    latestFailureCategory: mysqlEnum("latest_failure_category", failureCategoryValues),
    latestSummary: text("latest_summary"),
    latestSignals: json("latest_signals").$type<string[]>(),
    latestHttpStatus: int("latest_http_status"),
    latestFinalUrl: text("latest_final_url"),
    latestDurationMs: int("latest_duration_ms"),
    latestCheckedAt: timestamp("latest_checked_at"),
    latestAiClassification: varchar("latest_ai_classification", { length: 64 }),
    latestAiConfidence: int("latest_ai_confidence"),

    failureStartedAt: timestamp("failure_started_at"),
    alertSentAt: timestamp("alert_sent_at"),
    recoveredAt: timestamp("recovered_at"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (table) => [uniqueIndex("monitored_urls_normalized_hash_unique").on(table.normalizedUrlHash)],
);

export type MonitoredUrl = typeof monitoredUrls.$inferSelect;
export type NewMonitoredUrl = typeof monitoredUrls.$inferInsert;

export const userRoleValues = ["ADMIN", "VIEWER"] as const;
export type UserRole = (typeof userRoleValues)[number];

export const users = mysqlTable(
  "users",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    username: varchar("username", { length: 191 }).notNull(),
    name: varchar("name", { length: 191 }).notNull(),
    email: varchar("email", { length: 191 }),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    role: mysqlEnum("role", userRoleValues).notNull().default("VIEWER"),
    lastSignInAt: timestamp("last_sign_in_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_username_unique").on(table.username)],
);

export type User = typeof users.$inferSelect;

export const appSettings = mysqlTable("app_settings", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});
