import type { CompromiseFinding, CompromiseKind, CompromiseResult } from "~/db/schema";

export const COMPROMISE_RESULT_LABELS: Record<CompromiseResult, string> = {
  NOT_CHECKED: "Not checked",
  CLEAN: "Clean",
  SUSPICIOUS: "Suspicious",
  HACKED: "Hacked",
};

export const COMPROMISE_KIND_LABELS: Record<CompromiseKind, string> = {
  GAMBLING_SPAM: "Gambling spam",
  DEFACEMENT: "Defacement",
  REDIRECT: "Redirect",
  FOREIGN_SCRIPT: "Unknown script source",
  HIDDEN_IFRAME: "Hidden frame",
};

// Terms only gambling spam uses. They count as Compromise Evidence anywhere on the page,
// so they must never be words a legitimate article about gambling would use.
export const DEFAULT_SPAM_KEYWORDS = [
  "slot gacor",
  "gacor hari ini",
  "pola gacor",
  "rtp gacor",
  "link gacor",
  "slot88",
  "slot777",
  "maxwin",
  "anti rungkad",
  "situs toto",
  "toto togel",
  "toto macau",
  "rtp live",
  "rtp slot",
  "scatter hitam",
  "mahjong ways",
  "kakek zeus",
  "slot thailand",
  "slot server thailand",
  "slot kamboja",
  "akun pro thailand",
  "bocoran admin",
  "slot online terpercaya",
  "situs slot terpercaya",
  "agen slot",
  "bandar slot",
  "bo slot",
  "slot deposit pulsa",
  "slot deposit dana",
  "depo 5k",
  "depo 10k",
  "slot bet kecil",
  "mega888",
  "pussy888",
  "918kiss",
  "jili slot",
  "best online casino",
  "best casino sites",
  "top online casinos",
  "real money casino",
  "real money slots",
  "real money pokies",
  "no deposit bonus",
  "free spins no deposit",
  "casino bonus codes",
  "high rtp slots",
  "not on gamstop",
  "non gamstop",
  "non-gamstop",
];

// General gambling terms. News and police sites use them openly, so they only count
// when they appear in a hidden link pointing to another site.
export const DEFAULT_GAMBLING_KEYWORDS = [
  "judi",
  "judol",
  "togel",
  "casino",
  "kasino",
  "poker",
  "sabung ayam",
  "slot online",
  "online slots",
  "taruhan bola",
  "mix parlay",
  "sbobet",
  "baccarat",
  "roulette",
  "blackjack",
  "gambling",
  "betting",
  "sportsbook",
  "bookmaker",
  "jackpot",
  "lottery",
  "dominoqq",
  "bandarqq",
  "pkv games",
  "capsa susun",
];

export const DEFAULT_DEFACEMENT_KEYWORDS = [
  "hacked by",
  "defaced by",
  "h4cked by",
  "h4ck3d by",
  "d3f4c3d by",
  "pwned by",
  "pwn3d by",
  "0wn3d by",
  "greetz",
  "your security is low",
  "your security is very low",
  "this site has been hacked",
  "your site has been hacked",
  "we are legion",
  "di hack oleh",
];

/** The Compromise Status shown to users: an open Compromise Episode stays Hacked whatever the latest check saw. */
export function compromiseStatus(url: { compromiseStartedAt: Date | string | null; latestCompromiseResult: CompromiseResult }): CompromiseResult {
  return url.compromiseStartedAt ? "HACKED" : url.latestCompromiseResult;
}

export function formatCompromiseFinding(finding: CompromiseFinding) {
  return `${COMPROMISE_KIND_LABELS[finding.kind]}: ${finding.detail}`;
}

/** Keyword lists are stored as one entry per line (commas also accepted). */
export function parseKeywordList(value: string) {
  return [...new Set(value.split(/[\n,]/).map((entry) => entry.trim().toLowerCase()).filter(Boolean))];
}

export function resultOf(findings: CompromiseFinding[]): "CLEAN" | "SUSPICIOUS" | "HACKED" {
  if (findings.some((f) => f.level === "HACKED")) return "HACKED";
  return findings.length ? "SUSPICIOUS" : "CLEAN";
}
