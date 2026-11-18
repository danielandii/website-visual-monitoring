import { asc, eq, inArray } from "drizzle-orm";
import { getDb, withDbRetry } from "./client.server";
import { monitoredDomains, monitoredUrls, type MonitoredDomain } from "./schema";
import { registrableDomainOf } from "~/lib/domain";

export type MonitoredDomainWithUrls = MonitoredDomain & {
  urls: Array<{ id: number; name: string; url: string; enabled: boolean }>;
};

export async function listMonitoredDomainsWithUrls(): Promise<MonitoredDomainWithUrls[]> {
  const domains = await withDbRetry(
    () => getDb().select().from(monitoredDomains).orderBy(asc(monitoredDomains.registrableDomain)),
    { label: "list monitored domains" },
  );
  if (domains.length === 0) return [];

  const urls = await withDbRetry(
    () =>
      getDb()
        .select({ id: monitoredUrls.id, name: monitoredUrls.name, url: monitoredUrls.url, enabled: monitoredUrls.enabled })
        .from(monitoredUrls),
    { label: "list urls for domains" },
  );

  const byDomain = new Map<string, MonitoredDomainWithUrls["urls"]>();
  for (const url of urls) {
    const domain = registrableDomainOf(url.url);
    if (!domain) continue;
    const list = byDomain.get(domain) ?? [];
    list.push(url);
    byDomain.set(domain, list);
  }

  return domains.map((d) => ({ ...d, urls: byDomain.get(d.registrableDomain) ?? [] }));
}

export async function listMonitoredDomains() {
  return withDbRetry(
    () => getDb().select().from(monitoredDomains).orderBy(asc(monitoredDomains.registrableDomain)),
    { label: "list monitored domains" },
  );
}

/** Derive Monitored Domains from existing Monitored URLs: insert new, delete orphans. */
export async function syncMonitoredDomainsFromUrls() {
  const urls = await withDbRetry(
    () => getDb().select({ url: monitoredUrls.url }).from(monitoredUrls),
    { label: "sync domains: list urls" },
  );
  const derived = new Set<string>();
  for (const row of urls) {
    const domain = registrableDomainOf(row.url);
    if (domain) derived.add(domain);
  }

  const existing = await withDbRetry(
    () => getDb().select({ registrableDomain: monitoredDomains.registrableDomain }).from(monitoredDomains),
    { label: "sync domains: list existing" },
  );
  const existingSet = new Set(existing.map((r) => r.registrableDomain));

  const toInsert = [...derived].filter((d) => !existingSet.has(d));
  if (toInsert.length) {
    await getDb()
      .insert(monitoredDomains)
      .values(toInsert.map((registrableDomain) => ({ registrableDomain, sentThresholds: [] as number[] })));
  }

  const toDelete = [...existingSet].filter((d) => !derived.has(d));
  if (toDelete.length) {
    await getDb().delete(monitoredDomains).where(inArray(monitoredDomains.registrableDomain, toDelete));
  }

  return { inserted: toInsert.length, deleted: toDelete.length };
}

export async function updateRdapLookup(input: {
  id: number;
  rdapExpiresAt: Date | null;
  lastLookupError: string | null;
  lookedUpAt: Date;
}) {
  await withDbRetry(
    () =>
      getDb()
        .update(monitoredDomains)
        .set({
          rdapExpiresAt: input.rdapExpiresAt,
          lastLookupAt: input.lookedUpAt,
          lastLookupError: input.lastLookupError,
        })
        .where(eq(monitoredDomains.id, input.id)),
    { label: `update rdap lookup for domain ${input.id}` },
  );
}

export async function applyEffectiveExpiration(input: {
  id: number;
  expiresAt: Date | null;
  expiresAtSource: "RDAP" | "MANUAL" | "UNKNOWN";
  sentThresholds: number[];
}) {
  await withDbRetry(
    () =>
      getDb()
        .update(monitoredDomains)
        .set({
          expiresAt: input.expiresAt,
          expiresAtSource: input.expiresAtSource,
          sentThresholds: input.sentThresholds,
        })
        .where(eq(monitoredDomains.id, input.id)),
    { label: `apply expiration for domain ${input.id}` },
  );
}

export async function setManualExpiration(id: number, manualExpiresAt: Date | null) {
  await withDbRetry(
    () =>
      getDb()
        .update(monitoredDomains)
        .set({
          manualExpiresAt,
          manualExpiresAtSetAt: manualExpiresAt ? new Date() : null,
        })
        .where(eq(monitoredDomains.id, id)),
    { label: `set manual expiration for domain ${id}` },
  );
}

export async function findDomainById(id: number) {
  const [row] = await withDbRetry(
    () => getDb().select().from(monitoredDomains).where(eq(monitoredDomains.id, id)).limit(1),
    { label: `find monitored domain ${id}` },
  );
  return row ?? null;
}
