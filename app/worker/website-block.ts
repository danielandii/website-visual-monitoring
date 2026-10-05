import type { BlockType } from "~/db/schema";
import type { WebsiteBlock } from "./types";

export type BlockDetectionInput = {
  httpStatus: number | null;
  /** Main document response headers, lower-cased keys. */
  headers: Record<string, string>;
  /** Page title plus a sample of visible text. */
  pageText: string;
  textLength: number;
  hasCaptchaWidget: boolean;
};

export type BlockFindings = Record<BlockType, boolean>;

// Challenge and block pages are short interstitials. Text evidence on a long page is
// far more likely to be normal content (e.g. a "protected by reCAPTCHA" footer).
const INTERSTITIAL_MAX_TEXT = 1500;

const PROVIDERS: Array<{ name: string; headers: (h: Record<string, string>) => boolean; text?: RegExp }> = [
  {
    name: "Cloudflare",
    headers: (h) => "cf-ray" in h || "cf-mitigated" in h || /cloudflare/i.test(h.server ?? ""),
    text: /cloudflare ray id|performance (?:&|and) security by cloudflare/i,
  },
  {
    name: "Akamai",
    headers: (h) => "akamai-grn" in h || /akamai/i.test(h.server ?? ""),
    text: /reference\s*#\d+\.[0-9a-f]+\.\d+/i,
  },
  {
    name: "Imperva",
    headers: (h) => "x-iinfo" in h || /incapsula|imperva/i.test(h["x-cdn"] ?? ""),
    text: /incapsula incident id|request unsuccessful\. incapsula/i,
  },
  {
    name: "DataDome",
    headers: (h) => "x-datadome" in h || "x-datadome-cid" in h || "x-dd-b" in h || /datadome/i.test(h.server ?? ""),
  },
  {
    name: "Sucuri",
    headers: (h) => "x-sucuri-id" in h || "x-sucuri-block" in h || /sucuri/i.test(h.server ?? ""),
    text: /sucuri website firewall/i,
  },
  { name: "AWS WAF", headers: (h) => "x-amzn-waf-action" in h },
  { name: "Vercel", headers: (h) => "x-vercel-mitigated" in h || /vercel/i.test(h.server ?? "") },
];

const CAPTCHA_TEXT_RE = /\b(?:re)?captcha\b|hcaptcha|verify (?:that )?you are (?:a )?human|i'?m not a robot|are you a robot|press (?:&|and) hold/i;
const CHALLENGE_TEXT_RE =
  /checking (?:if the site connection is secure|your browser)|just a moment\.{0,3}|enable javascript and cookies to continue|ddos protection by|please wait while we (?:verify|check) your browser|browser verification/i;
const PROVIDER_DENIAL_TEXT_RE =
  /error\s*10(?:06|07|08|09|10|12|20)\b|you have been blocked|incapsula incident id|request unsuccessful\. incapsula|sucuri website firewall - access denied|reference\s*#\d+\.[0-9a-f]+\.\d+|this request was blocked by the security rules|request blocked/i;
// Only counts with an identified provider: a bare origin "403 Forbidden" must stay a Failure.
const GENERIC_DENIAL_TEXT_RE = /\baccess denied\b/i;
const RATE_LIMIT_TEXT_RE = /error\s*1015\b|you are being rate limited|rate limit(?:ed)? exceeded/i;

export function detectWebsiteBlock(input: BlockDetectionInput): WebsiteBlock | null {
  const provider = detectProtectionProvider(input);
  const { findings, evidence } = collectBlockEvidence(input, provider);
  const type = resolveBlockType(findings);
  if (!type) return null;
  return { type, provider, evidence };
}

export function detectProtectionProvider(input: Pick<BlockDetectionInput, "headers" | "pageText">) {
  const match = PROVIDERS.find((p) => p.headers(input.headers) || (p.text?.test(input.pageText) ?? false));
  return match?.name ?? null;
}

export function collectBlockEvidence(input: BlockDetectionInput, provider: string | null) {
  const findings: BlockFindings = { CAPTCHA: false, BOT_CHALLENGE: false, ACCESS_DENIED: false, RATE_LIMITED: false };
  const evidence: string[] = [];
  const found = (type: BlockType, note: string) => {
    findings[type] = true;
    evidence.push(note);
  };
  const h = input.headers;
  const interstitial = input.textLength < INTERSTITIAL_MAX_TEXT;
  const textMatch = (re: RegExp) => (interstitial ? input.pageText.match(re)?.[0] : undefined);

  // Explicit mitigation headers set by the provider on the response it generated.
  if (h["cf-mitigated"] === "challenge") found("BOT_CHALLENGE", "header cf-mitigated: challenge");
  const awsAction = h["x-amzn-waf-action"]?.toLowerCase();
  if (awsAction === "captcha") found("CAPTCHA", "header x-amzn-waf-action: captcha");
  if (awsAction === "challenge") found("BOT_CHALLENGE", "header x-amzn-waf-action: challenge");
  if (awsAction === "block") found("ACCESS_DENIED", "header x-amzn-waf-action: block");
  const vercel = h["x-vercel-mitigated"]?.toLowerCase();
  if (vercel === "challenge") found("BOT_CHALLENGE", "header x-vercel-mitigated: challenge");
  if (vercel === "deny") found("ACCESS_DENIED", "header x-vercel-mitigated: deny");
  if ("x-sucuri-block" in h) found("ACCESS_DENIED", `header x-sucuri-block: ${h["x-sucuri-block"]}`);

  if (input.hasCaptchaWidget && interstitial) found("CAPTCHA", "captcha widget on a short page");

  const captchaText = textMatch(CAPTCHA_TEXT_RE);
  if (captchaText) found("CAPTCHA", `text "${captchaText}"`);
  const challengeText = textMatch(CHALLENGE_TEXT_RE);
  if (challengeText) found("BOT_CHALLENGE", `text "${challengeText}"`);
  const denialText = textMatch(PROVIDER_DENIAL_TEXT_RE) ?? (provider ? textMatch(GENERIC_DENIAL_TEXT_RE) : undefined);
  if (denialText) found("ACCESS_DENIED", `text "${denialText}"`);
  const rateText = textMatch(RATE_LIMIT_TEXT_RE);
  if (rateText) found("RATE_LIMITED", `text "${rateText}"`);
  if (input.httpStatus === 429 && provider) found("RATE_LIMITED", `HTTP 429 from ${provider}`);

  if (evidence.length && input.httpStatus && input.httpStatus >= 400 && !evidence.some((e) => e.startsWith("HTTP "))) {
    evidence.push(`HTTP ${input.httpStatus}`);
  }
  return { findings, evidence };
}

/**
 * Picks the single Block Type to show when the evidence points at one or more kinds.
 * A Cloudflare managed challenge, for example, can show both "Just a moment" text
 * (BOT_CHALLENGE) and a Turnstile widget (CAPTCHA) on the same page.
 * Returns null when nothing was found, which means the check is not a Website Block.
 */
export function resolveBlockType(findings: BlockFindings): BlockType | null {
  // Root cause first (rate limiting, hard denial), then what needs a human over what may pass on its own.
  const order: BlockType[] = ["RATE_LIMITED", "ACCESS_DENIED", "CAPTCHA", "BOT_CHALLENGE"];
  return order.find((type) => findings[type]) ?? null;
}
