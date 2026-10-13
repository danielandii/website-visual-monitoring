import type { CompromiseFinding } from "~/db/schema";
import { parseKeywordList, resultOf } from "~/lib/compromise";
import type { CompromiseCheck } from "./types";

/** What the browser saw on the page, collected by `collectPageObservation`. */
export type PageObservation = {
  title: string;
  visibleText: string;
  visibleTextLength: number;
  /** Text of hidden elements plus SEO meta tags: places spam hides from human visitors. */
  hiddenText: string;
  links: Array<{ href: string; text: string; hidden: boolean }>;
  frames: Array<{ src: string; hidden: boolean }>;
};

export type CompromiseInput = {
  inputUrl: string;
  finalUrl: string;
  observation: PageObservation;
  /** Hostnames of every script the page requested, including ones the monitor aborted. */
  scriptHosts: string[];
  /** Null until learned from the first examined check; no source is suspicious while learning. */
  knownScriptSources: string[] | null;
  keywords: { spam: string; gambling: string; defacement: string };
};

// Script and frame sites common enough that a new one appearing is not worth a Compromise Suspicion.
// polyfill.io is deliberately absent: its domain was taken over and served malware in 2024.
const COMMON_SCRIPT_SOURCES = new Set([
  "google.com",
  "googleapis.com",
  "gstatic.com",
  "googletagmanager.com",
  "google-analytics.com",
  "googlesyndication.com",
  "googleadservices.com",
  "doubleclick.net",
  "recaptcha.net",
  "youtube.com",
  "ytimg.com",
  "cloudflare.com",
  "cloudflareinsights.com",
  "jsdelivr.net",
  "unpkg.com",
  "jquery.com",
  "bootstrapcdn.com",
  "fontawesome.com",
  "typekit.net",
  "facebook.net",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "twimg.com",
  "tiktok.com",
  "linkedin.com",
  "licdn.com",
  "hotjar.com",
  "clarity.ms",
  "intercom.io",
  "intercomcdn.com",
  "crisp.chat",
  "tawk.to",
  "hcaptcha.com",
  "wp.com",
  "wordpress.com",
  "gravatar.com",
  "vimeo.com",
  "stripe.com",
  "stripe.network",
  "paypal.com",
  "cookiebot.com",
  "onetrust.com",
  "cookielaw.org",
]);

// Second-level labels under a country TLD that act like a TLD (polri.go.id, example.co.uk).
const COUNTRY_SECOND_LEVELS = new Set(["co", "ac", "go", "or", "web", "sch", "my", "net", "com", "org", "gov", "edu", "mil", "biz", "ponpes", "desa"]);

const MAX_FINDINGS = 10;
const MAX_DETAIL = 160;
const SHORT_PAGE_TEXT = 3000;

export function assessCompromise(input: CompromiseInput): CompromiseCheck {
  const spam = keywordSet(input.keywords.spam);
  const gambling = keywordSet(input.keywords.gambling);
  const defacement = keywordSet(input.keywords.defacement);
  const inputSite = siteOf(hostOf(input.inputUrl) ?? "");
  const { observation } = input;
  const findings: CompromiseFinding[] = [];
  const add = (finding: CompromiseFinding) => {
    const detail = finding.detail.slice(0, MAX_DETAIL);
    if (!findings.some((f) => f.kind === finding.kind && f.detail === detail)) findings.push({ ...finding, detail });
  };

  const textSources: Array<[string, string]> = [
    ["page title", observation.title],
    ["visible text", observation.visibleText],
    ["hidden text", observation.hiddenText],
  ];
  for (const [where, text] of textSources) {
    const term = firstTextMatch(text, spam);
    if (term) add({ kind: "GAMBLING_SPAM", level: "HACKED", detail: `"${term}" in ${where}` });
  }

  const outbound = observation.links.filter((link) => {
    const host = hostOf(link.href);
    return host && siteOf(host) !== inputSite;
  });
  for (const link of outbound) {
    // Only the hostname: a news article path like /waspada-iklan-slot-gacor is not spam.
    const term = firstTextMatch(link.text, spam) ?? firstCompactMatch(hostOf(link.href) ?? "", spam);
    if (term) {
      add({ kind: "GAMBLING_SPAM", level: "HACKED", detail: `"${term}" in link to ${link.href}` });
      continue;
    }
    if (!link.hidden) continue;
    const general = firstTextMatch(link.text, gambling) ?? firstCompactMatch(hostOf(link.href) ?? "", gambling);
    if (general) add({ kind: "GAMBLING_SPAM", level: "HACKED", detail: `"${general}" in hidden link to ${link.href}` });
  }

  // Defacement replaces the page, so its text sits in the title or on a short page;
  // a long page mentioning "hacked by" is far more likely an article.
  const defacementTerm =
    firstTextMatch(observation.title, defacement) ??
    (observation.visibleTextLength < SHORT_PAGE_TEXT ? firstTextMatch(observation.visibleText, defacement) : null);
  if (defacementTerm) add({ kind: "DEFACEMENT", level: "HACKED", detail: `"${defacementTerm}" on the page` });

  const finalHost = hostOf(input.finalUrl);
  if (finalHost && siteOf(finalHost) !== inputSite) {
    const gamblingPage = findings.some((f) => f.kind === "GAMBLING_SPAM");
    const term = firstCompactMatch(input.finalUrl, spam) ?? firstCompactMatch(finalHost, gambling);
    add(
      term || gamblingPage
        ? { kind: "REDIRECT", level: "HACKED", detail: `Redirected to gambling site ${input.finalUrl}` }
        : { kind: "REDIRECT", level: "SUSPICIOUS", detail: `Redirected to another site ${input.finalUrl}` },
    );
  }

  const known = new Set(input.knownScriptSources ?? []);
  const isKnown = (site: string) => COMMON_SCRIPT_SOURCES.has(site) || known.has(site);
  const learning = input.knownScriptSources === null;
  const thirdPartySources = new Set<string>();

  for (const host of new Set(input.scriptHosts)) {
    const site = siteOf(host);
    if (site === inputSite) continue;
    if (!COMMON_SCRIPT_SOURCES.has(site)) thirdPartySources.add(site);
    const term = firstCompactMatch(host, spam);
    if (term) add({ kind: "FOREIGN_SCRIPT", level: "HACKED", detail: `Script from gambling site ${host}`, source: site });
    else if (!learning && !isKnown(site)) add({ kind: "FOREIGN_SCRIPT", level: "SUSPICIOUS", detail: `Script from ${host}`, source: site });
  }

  for (const frame of observation.frames) {
    const host = hostOf(frame.src);
    if (!host || !frame.hidden) continue;
    const site = siteOf(host);
    if (site === inputSite) continue;
    if (!COMMON_SCRIPT_SOURCES.has(site)) thirdPartySources.add(site);
    const term = firstCompactMatch(host, spam) ?? firstCompactMatch(host, gambling);
    if (term) add({ kind: "HIDDEN_IFRAME", level: "HACKED", detail: `Hidden frame from gambling site ${host}`, source: site });
    else if (!learning && !isKnown(site)) add({ kind: "HIDDEN_IFRAME", level: "SUSPICIOUS", detail: `Hidden frame from ${host}`, source: site });
  }

  const ranked = [...findings.filter((f) => f.level === "HACKED"), ...findings.filter((f) => f.level === "SUSPICIOUS")].slice(0, MAX_FINDINGS);
  return { result: resultOf(ranked), findings: ranked, thirdPartySources: [...thirdPartySources].sort() };
}

/** Merges two attempts of the same check: one sighting of Compromise Evidence is enough. */
export function mergeCompromiseChecks(first: CompromiseCheck | null | undefined, retry: CompromiseCheck | null | undefined): CompromiseCheck | null {
  if (!first) return retry ?? null;
  if (!retry) return first;
  const findings = [...retry.findings];
  for (const finding of first.findings) {
    if (!findings.some((f) => f.kind === finding.kind && f.detail === finding.detail)) findings.push(finding);
  }
  const ranked = [...findings.filter((f) => f.level === "HACKED"), ...findings.filter((f) => f.level === "SUSPICIOUS")].slice(0, MAX_FINDINGS);
  return {
    result: resultOf(ranked),
    findings: ranked,
    thirdPartySources: [...new Set([...first.thirdPartySources, ...retry.thirdPartySources])].sort(),
  };
}

/** Approximate registrable domain, so cdn.example.co.id and www.example.co.id count as one site. */
export function siteOf(host: string) {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const take = tld.length === 2 && COUNTRY_SECOND_LEVELS.has(second) ? 3 : 2;
  return labels.slice(-take).join(".");
}

function hostOf(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

function keywordSet(list: string) {
  return parseKeywordList(list).map((term) => ({
    term,
    pattern: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "iu"),
    compact: compact(term),
  }));
}

function firstTextMatch(text: string, keywords: ReturnType<typeof keywordSet>) {
  if (!text) return null;
  return keywords.find((k) => k.pattern.test(text))?.term ?? null;
}

/** Matches inside URLs and hostnames, where words run together: slot-gacor, slotgacor88.com. */
function firstCompactMatch(value: string, keywords: ReturnType<typeof keywordSet>) {
  const haystack = compact(value);
  if (!haystack) return null;
  return keywords.find((k) => k.compact.length >= 4 && haystack.includes(k.compact))?.term ?? null;
}

function compact(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
