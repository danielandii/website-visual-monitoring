import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, getPool, isTransientDatabaseError, resetPool, withDbRetry } from "./client.server";
import { monitoredUrls, type FailureCategory, type LatestStatus, type MonitoredUrl } from "./schema";
import { normalizeUrl } from "~/lib/url";
import { hashNormalizedUrl } from "~/lib/url.server";

export async function listMonitoredUrls() {
  return withDbRetry(() => getDb().select().from(monitoredUrls).orderBy(asc(monitoredUrls.name)), { label: "list monitored urls" });
}

export async function countMonitoredUrls() {
  const [row] = await withDbRetry(() => getDb().select({ count: sql<number>`count(*)` }).from(monitoredUrls), { label: "count monitored urls" });
  return Number(row?.count ?? 0);
}

export async function resetLatestResults() {
  await withDbRetry(
    () =>
      getDb().update(monitoredUrls).set({
        latestStatus: "UNKNOWN",
        latestFailureCategory: null,
        latestSummary: null,
        latestSignals: null,
        latestHttpStatus: null,
        latestFinalUrl: null,
        latestDurationMs: null,
        latestCheckedAt: null,
        latestAiClassification: null,
        latestAiConfidence: null,
        failureStartedAt: null,
        alertSentAt: null,
        recoveredAt: null,
        nextCheckAt: new Date(),
      }),
    { label: "reset latest results" },
  );
}

export async function deleteAllMonitoredUrls() {
  await withDbRetry(() => getDb().delete(monitoredUrls), { label: "delete all monitored urls" });
}

export async function createMonitoredUrl(input: { name: string; url: string; enabled?: boolean; nextCheckAt?: Date }) {
  const normalizedUrl = normalizeUrl(input.url);
  const normalizedUrlHash = hashNormalizedUrl(normalizedUrl);

  await getDb().insert(monitoredUrls).values({
    name: input.name.trim() || new URL(normalizedUrl).hostname,
    url: input.url.trim(),
    normalizedUrl,
    normalizedUrlHash,
    enabled: input.enabled ?? true,
    nextCheckAt: input.nextCheckAt ?? new Date(),
  });
}

export async function updateMonitoredUrl(input: { id: number; name: string; url: string; enabled: boolean }) {
  const normalizedUrl = normalizeUrl(input.url);
  const normalizedUrlHash = hashNormalizedUrl(normalizedUrl);

  await withDbRetry(
    async () => {
      await getDb()
        .update(monitoredUrls)
        .set({
          name: input.name.trim() || new URL(normalizedUrl).hostname,
          url: input.url.trim(),
          normalizedUrl,
          normalizedUrlHash,
          enabled: input.enabled,
        })
        .where(eq(monitoredUrls.id, input.id));
    },
    { label: `update monitored url ${input.id}` },
  );
}

export async function setMonitoredUrlEnabled(id: number, enabled: boolean) {
  await withDbRetry(async () => {
    await getDb().update(monitoredUrls).set({ enabled }).where(eq(monitoredUrls.id, id));
  }, { label: `set monitored url ${id} enabled=${enabled}` });
}

export async function deleteMonitoredUrl(id: number) {
  await withDbRetry(async () => {
    await getDb().delete(monitoredUrls).where(eq(monitoredUrls.id, id));
  }, { label: `delete monitored url ${id}` });
}

export async function importMonitoredUrlsCsv(csv: string, cadenceMinutes: number) {
  const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const dataLines = lines[0]?.toLowerCase().startsWith("name,") ? lines.slice(1) : lines;
  const candidates = dataLines.map(parseCsvLine).filter(Boolean) as Array<{ name: string; url: string; enabled: boolean }>;

  const normalized = candidates.map((row) => {
    try {
      const normalizedUrl = normalizeUrl(row.url);
      return { ...row, normalizedUrl, normalizedUrlHash: hashNormalizedUrl(normalizedUrl) };
    } catch {
      return null;
    }
  });

  const invalid = normalized.filter((row) => row === null).length;
  const valid = normalized.filter(Boolean) as Array<{ name: string; url: string; enabled: boolean; normalizedUrl: string; normalizedUrlHash: string }>;
  const uniqueInFile = new Map<string, (typeof valid)[number]>();
  for (const row of valid) uniqueInFile.set(row.normalizedUrlHash, row);

  const hashes = [...uniqueInFile.keys()];
  const existing = hashes.length
    ? await withDbRetry(
        () => getDb().select({ normalizedUrlHash: monitoredUrls.normalizedUrlHash }).from(monitoredUrls).where(inArray(monitoredUrls.normalizedUrlHash, hashes)),
        { label: "check imported monitored url duplicates" },
      )
    : [];
  const existingHashes = new Set(existing.map((row) => row.normalizedUrlHash));
  const toInsert = [...uniqueInFile.values()].filter((row) => !existingHashes.has(row.normalizedUrlHash));
  const spacingMs = toInsert.length ? Math.floor((cadenceMinutes * 60 * 1000) / toInsert.length) : 0;
  const now = Date.now();

  if (toInsert.length) {
    await getDb().insert(monitoredUrls).values(
      toInsert.map((row, index) => ({
        name: row.name || new URL(row.normalizedUrl).hostname,
        url: row.url,
        normalizedUrl: row.normalizedUrl,
        normalizedUrlHash: row.normalizedUrlHash,
        enabled: row.enabled,
        nextCheckAt: new Date(now + spacingMs * index),
      })),
    );
  }

  return {
    imported: toInsert.length,
    skippedDuplicates: valid.length - uniqueInFile.size + existingHashes.size,
    invalid,
  };
}

function parseCsvLine(line: string) {
  const parts = line.split(",").map((part) => part.trim());
  const [name, url, enabledRaw = "true"] = parts;
  if (!url) return null;
  return { name, url, enabled: !["false", "0", "no", "disabled"].includes(enabledRaw.toLowerCase()) };
}

export async function claimNextDueUrl(workerId: string, staleClaimSeconds: number) {
  const claimOwner = makeClaimOwner(workerId);
  const attempts = Number(process.env.DB_RETRY_ATTEMPTS ?? 3);
  const baseDelayMs = Number(process.env.DB_RETRY_BASE_DELAY_MS ?? 250);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const attemptPool = getPool();
    try {
      const [result] = await attemptPool.execute(
        `UPDATE monitored_urls
         SET check_claimed_at = UTC_TIMESTAMP(), check_claimed_by = ?
         WHERE id = (
           SELECT id FROM (
             SELECT id
             FROM monitored_urls
             WHERE enabled = true
               AND next_check_at <= UTC_TIMESTAMP()
               AND (check_claimed_at IS NULL OR check_claimed_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? SECOND))
             ORDER BY next_check_at ASC
             LIMIT 1
           ) due_url
         )`,
        [claimOwner, staleClaimSeconds],
      );

      if ((result as { affectedRows?: number }).affectedRows === 0) return null;
      return await findClaimedUrl(claimOwner);
    } catch (error) {
      if (!isTransientDatabaseError(error) || attempt >= attempts) throw error;

      await resetPool(attemptPool);
      const recoveredClaim = await findClaimedUrlAfterAmbiguousFailure(claimOwner);
      if (recoveredClaim) return recoveredClaim;

      const waitMs = baseDelayMs * 2 ** (attempt - 1);
      console.warn(`Transient database error while claiming next due URL; retrying in ${waitMs}ms (${attempt}/${attempts})`);
      await delay(waitMs);
    }
  }

  return null;
}

export async function updateCheckOutcome(input: {
  id: number;
  previous: MonitoredUrl;
  status: LatestStatus;
  failureCategory: FailureCategory | null;
  summary: string;
  signals: string[];
  httpStatus: number | null;
  finalUrl: string | null;
  durationMs: number;
  aiClassification?: string | null;
  aiConfidence?: number | null;
  checkedAt: Date;
  nextCheckAt: Date;
  alertSentAt?: Date | null;
}) {
  const isOk = input.status === "OK";
  const isFailing = input.status === "FAILING";

  await withDbRetry(
    async () => {
      await getDb()
        .update(monitoredUrls)
        .set({
          latestStatus: input.status,
          latestFailureCategory: input.failureCategory,
          latestSummary: input.summary,
          latestSignals: input.signals,
          latestHttpStatus: input.httpStatus,
          latestFinalUrl: input.finalUrl,
          latestDurationMs: input.durationMs,
          latestCheckedAt: input.checkedAt,
          latestAiClassification: input.aiClassification ?? null,
          latestAiConfidence: input.aiConfidence ?? null,
          failureStartedAt: isOk ? null : isFailing ? input.previous.failureStartedAt ?? input.checkedAt : input.previous.failureStartedAt,
          alertSentAt: isOk ? null : isFailing ? input.alertSentAt ?? input.previous.alertSentAt : input.previous.alertSentAt,
          recoveredAt: isOk && input.previous.failureStartedAt ? input.checkedAt : input.previous.recoveredAt,
          nextCheckAt: input.nextCheckAt,
          checkClaimedAt: null,
          checkClaimedBy: null,
        })
        .where(eq(monitoredUrls.id, input.id));
    },
    { label: `update check outcome for monitored url ${input.id}` },
  );
}

function makeClaimOwner(workerId: string) {
  return `${workerId.slice(0, 150)}:${randomUUID()}`;
}

async function findClaimedUrl(claimOwner: string) {
  const [row] = await getDb().select().from(monitoredUrls).where(eq(monitoredUrls.checkClaimedBy, claimOwner)).limit(1);
  return row ?? null;
}

async function findClaimedUrlAfterAmbiguousFailure(claimOwner: string) {
  const verificationPool = getPool();
  try {
    return await findClaimedUrl(claimOwner);
  } catch (error) {
    if (!isTransientDatabaseError(error)) throw error;
    await resetPool(verificationPool);
    return null;
  }
}

export function nextFutureSlot(previousScheduled: Date, cadenceMinutes: number, now = new Date()) {
  const cadenceMs = cadenceMinutes * 60 * 1000;
  let next = new Date(previousScheduled.getTime() + cadenceMs);
  while (next <= now) {
    next = new Date(next.getTime() + cadenceMs);
  }
  return next;
}
