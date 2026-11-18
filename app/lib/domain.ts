import { getDomain } from "tldts";

/** Registrable domain (eTLD+1) for a Monitored URL; null if the host is an IP or an unknown suffix. */
export function registrableDomainOf(rawUrl: string): string | null {
  try {
    const hostname = new URL(rawUrl).hostname;
    return getDomain(hostname) ?? null;
  } catch {
    return null;
  }
}
