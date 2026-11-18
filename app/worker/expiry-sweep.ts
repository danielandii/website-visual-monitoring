import { setTimeout as delay } from "node:timers/promises";
import { listMonitoredUrls } from "~/db/monitored-urls.server";
import {
  applyEffectiveExpiration,
  listMonitoredDomains,
  syncMonitoredDomainsFromUrls,
  updateRdapLookup,
} from "~/db/monitored-domains.server";
import { EXPIRY_THRESHOLDS, type MonitoredDomain } from "~/db/schema";
import { registrableDomainOf } from "~/lib/domain";
import type { DiscordAlertDispatcher } from "./discord";
import { lookupRdapExpiration } from "./rdap";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const RENEWAL_FORWARD_JUMP_DAYS = 60;

/** Runs one full Domain Expiry sweep: sync, RDAP lookup, evaluate thresholds, send alerts. */
export async function runExpirySweep(
  discord: DiscordAlertDispatcher,
  options: { now?: Date; signal?: AbortSignal } = {},
) {
  const now = options.now ?? new Date();
  const signal = options.signal;
  await syncMonitoredDomainsFromUrls();
  const [domains, urls] = await Promise.all([listMonitoredDomains(), listMonitoredUrls()]);

  const urlsByDomain = new Map<string, Array<{ name: string; url: string }>>();
  for (const u of urls) {
    const d = registrableDomainOf(u.url);
    if (!d) continue;
    const list = urlsByDomain.get(d) ?? [];
    list.push({ name: u.name, url: u.url });
    urlsByDomain.set(d, list);
  }

  console.log(`Expiry sweep: ${domains.length} domain(s) to check.`);

  let processed = 0;
  for (const domain of domains) {
    if (signal?.aborted) {
      console.log(`Expiry sweep stopped after ${processed}/${domains.length} domain(s).`);
      return { processed, total: domains.length, stopped: true as const };
    }
    try {
      await sweepOneDomain(domain, urlsByDomain.get(domain.registrableDomain) ?? [], discord, now, signal);
    } catch (error) {
      if (signal?.aborted) {
        console.log(`Expiry sweep stopped after ${processed}/${domains.length} domain(s).`);
        return { processed, total: domains.length, stopped: true as const };
      }
      console.error(`Expiry sweep failed for ${domain.registrableDomain}`, error);
    }
    processed += 1;
    // Space RDAP lookups to be gentle on registries.
    try {
      await delay(500, undefined, { signal });
    } catch {
      // Abort during delay — loop head will detect and return.
    }
  }

  return { processed, total: domains.length, stopped: false as const };
}

async function sweepOneDomain(
  domain: MonitoredDomain,
  affectedUrls: Array<{ name: string; url: string }>,
  discord: DiscordAlertDispatcher,
  now: Date,
  signal?: AbortSignal,
) {
  const lookup = await lookupRdapExpiration(domain.registrableDomain, 15_000, signal);
  const lookedUpAt = new Date();
  const rdapExpiresAt = lookup.ok ? lookup.expiresAt : domain.rdapExpiresAt;
  const lastLookupError = lookup.ok ? null : lookup.error;

  await updateRdapLookup({ id: domain.id, rdapExpiresAt, lastLookupError, lookedUpAt });

  // Resolve effective expiration: manual wins if set.
  const previousEffective = domain.expiresAt;
  let effective: Date | null = null;
  let source: "RDAP" | "MANUAL" | "UNKNOWN" = "UNKNOWN";
  if (domain.manualExpiresAt) {
    effective = domain.manualExpiresAt;
    source = "MANUAL";
  } else if (rdapExpiresAt) {
    effective = rdapExpiresAt;
    source = "RDAP";
  }

  // Renewal detection: effective moved forward by ≥ 60 days → reset sent thresholds.
  let sentThresholds = [...domain.sentThresholds];
  if (previousEffective && effective && daysBetween(previousEffective, effective) >= RENEWAL_FORWARD_JUMP_DAYS) {
    sentThresholds = [];
  }

  if (effective) {
    const daysToExpiry = Math.floor((effective.getTime() - now.getTime()) / MS_PER_DAY);
    for (const threshold of EXPIRY_THRESHOLDS) {
      if (daysToExpiry > threshold) continue;
      if (sentThresholds.includes(threshold)) continue;
      const sent = await discord.sendExpiryAlert({
        registrableDomain: domain.registrableDomain,
        expiresAt: effective,
        thresholdDays: threshold,
        source,
        affectedUrls,
      });
      if (sent) sentThresholds.push(threshold);
    }
  }

  await applyEffectiveExpiration({
    id: domain.id,
    expiresAt: effective,
    expiresAtSource: source,
    sentThresholds,
  });
}

function daysBetween(earlier: Date, later: Date) {
  return (later.getTime() - earlier.getTime()) / MS_PER_DAY;
}
