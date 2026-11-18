export type RdapLookupResult =
  | { ok: true; expiresAt: Date | null }
  | { ok: false; error: string };

type RdapEvent = { eventAction?: string; eventDate?: string };
type RdapResponse = { events?: RdapEvent[] };

const RDAP_BOOTSTRAP = "https://rdap.org/domain/";
const MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RETRY_WAIT_MS = 2_000;
const MAX_RETRY_WAIT_MS = 15_000;

/** Looks up a registrable domain via RDAP (via rdap.org which redirects to the TLD's authoritative server). */
export async function lookupRdapExpiration(
  registrableDomain: string,
  timeoutMs = 15_000,
  externalSignal?: AbortSignal,
): Promise<RdapLookupResult> {
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    if (externalSignal?.aborted) return { ok: false, error: "RDAP: cancelled." };
    const result = await attemptLookup(registrableDomain, timeoutMs, externalSignal);
    if (result.kind !== "rate-limited") return result.value;
    if (attempt === MAX_RATE_LIMIT_RETRIES) {
      return { ok: false, error: `RDAP: rate limited (429) after ${MAX_RATE_LIMIT_RETRIES + 1} attempts.` };
    }
    const waitMs = Math.min(
      result.retryAfterMs ?? DEFAULT_RETRY_WAIT_MS * 2 ** attempt,
      MAX_RETRY_WAIT_MS,
    );
    const aborted = await sleep(waitMs, externalSignal);
    if (aborted) return { ok: false, error: "RDAP: cancelled." };
  }
  return { ok: false, error: "RDAP: rate limited (429)." };
}

type AttemptOutcome =
  | { kind: "done"; value: RdapLookupResult }
  | { kind: "rate-limited"; retryAfterMs: number | null };

async function attemptLookup(
  registrableDomain: string,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<AttemptOutcome> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onExternalAbort);
  try {
    const response = await fetch(`${RDAP_BOOTSTRAP}${encodeURIComponent(registrableDomain)}`, {
      headers: {
        Accept: "application/rdap+json",
        "User-Agent": "WebsiteVisualMonitoring/1.0 (+https://github.com/agyanatma/website-visual-monitoring)",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    if (response.status === 404) return done({ ok: false, error: "RDAP: domain not found or TLD not supported." });
    if (response.status === 429) {
      return { kind: "rate-limited", retryAfterMs: parseRetryAfter(response.headers.get("retry-after")) };
    }
    if (!response.ok) return done({ ok: false, error: `RDAP: HTTP ${response.status}.` });

    const data = (await response.json()) as RdapResponse;
    const event = (data.events ?? []).find((e) =>
      typeof e.eventAction === "string" && /expiration/i.test(e.eventAction),
    );
    if (!event?.eventDate) return done({ ok: true, expiresAt: null });

    const parsed = new Date(event.eventDate);
    if (Number.isNaN(parsed.getTime())) {
      return done({ ok: false, error: `RDAP: unparseable expiration date '${event.eventDate}'.` });
    }
    return done({ ok: true, expiresAt: parsed });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return done({ ok: false, error: externalSignal?.aborted ? "RDAP: cancelled." : "RDAP: lookup timed out." });
    }
    return done({ ok: false, error: `RDAP: ${error instanceof Error ? error.message : String(error)}` });
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

function done(value: RdapLookupResult): AttemptOutcome {
  return { kind: "done", value };
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_WAIT_MS);
  const asDate = Date.parse(header);
  if (!Number.isNaN(asDate)) return Math.max(0, Math.min(asDate - Date.now(), MAX_RETRY_WAIT_MS));
  return null;
}

/** Resolves true when the caller's signal aborts, false after the delay. */
function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(true);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(false);
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(true);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
