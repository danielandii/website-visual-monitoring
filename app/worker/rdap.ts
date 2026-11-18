export type RdapLookupResult =
  | { ok: true; expiresAt: Date | null }
  | { ok: false; error: string };

type RdapEvent = { eventAction?: string; eventDate?: string };
type RdapResponse = { events?: RdapEvent[] };

const RDAP_BOOTSTRAP = "https://rdap.org/domain/";

/** Looks up a registrable domain via RDAP (via rdap.org which redirects to the TLD's authoritative server). */
export async function lookupRdapExpiration(
  registrableDomain: string,
  timeoutMs = 15_000,
  externalSignal?: AbortSignal,
): Promise<RdapLookupResult> {
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

    if (response.status === 404) return { ok: false, error: "RDAP: domain not found or TLD not supported." };
    if (response.status === 429) return { ok: false, error: "RDAP: rate limited (429)." };
    if (!response.ok) return { ok: false, error: `RDAP: HTTP ${response.status}.` };

    const data = (await response.json()) as RdapResponse;
    const event = (data.events ?? []).find((e) =>
      typeof e.eventAction === "string" && /expiration/i.test(e.eventAction),
    );
    if (!event?.eventDate) return { ok: true, expiresAt: null };

    const parsed = new Date(event.eventDate);
    if (Number.isNaN(parsed.getTime())) return { ok: false, error: `RDAP: unparseable expiration date '${event.eventDate}'.` };
    return { ok: true, expiresAt: parsed };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: externalSignal?.aborted ? "RDAP: cancelled." : "RDAP: lookup timed out." };
    }
    return { ok: false, error: `RDAP: ${error instanceof Error ? error.message : String(error)}` };
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}
