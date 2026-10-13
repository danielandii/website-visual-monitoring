import { setTimeout as delay } from "node:timers/promises";
import type { Browser, BrowserContext, ConsoleMessage, Page, Response } from "playwright";
import type { AppConfig } from "~/lib/config.server";
import type { CheckOutcome, CompromiseCheck } from "./types";
import type { OpenRouterVisualClassifier } from "./ai";
import { detectWebsiteBlock } from "./website-block";
import { assessCompromise, type PageObservation } from "./compromise";
import { formatWebsiteBlock } from "~/lib/website-block";

const BLOCKED_HOST_PATTERNS = [
  "google-analytics.com",
  "googletagmanager.com",
  "facebook.net",
  "doubleclick.net",
  "hotjar.com",
  "clarity.ms",
  "intercom.io",
  "intercomcdn.com",
  "crisp.chat",
];

const MONITOR_INTERFERENCE_SCRIPT_PATTERNS = [
  /inspect-element-console-blocker/i,
  /\/devtools-detect(?:\.min)?\.js(?:\?|$)/i,
  /\/disable-devtool(?:\.min)?\.js(?:\?|$)/i,
  /\/block-(?:console|keys|right-click)(?:\.min)?\.js(?:\?|$)/i,
];

const MAX_CONSOLE_MESSAGES = 100;
const MAX_CAPTURED_BROWSER_ERRORS = 5;

const ERROR_TEXT_RE = /\b(404 not found|500 internal server error|502 bad gateway|503 service unavailable|service unavailable|maintenance mode|temporarily unavailable|application error|server error)\b/i;

export async function checkUrl(
  browser: Browser,
  url: string,
  config: AppConfig,
  ai: OpenRouterVisualClassifier,
  knownScriptSources: string[] | null,
) {
  return withTimeout(runCheck(browser, url, config, ai, knownScriptSources), config.TOTAL_CHECK_TIMEOUT_MS, () => ({
    status: "UNKNOWN" as const,
    failureCategory: null,
    summary: "The monitor exceeded the total timeout before it could verify the page.",
    signals: ["total_timeout"],
    httpStatus: null,
    finalUrl: url,
    durationMs: config.TOTAL_CHECK_TIMEOUT_MS,
  } satisfies CheckOutcome));
}

async function runCheck(
  browser: Browser,
  url: string,
  config: AppConfig,
  ai: OpenRouterVisualClassifier,
  knownScriptSources: string[] | null,
): Promise<CheckOutcome> {
  const started = Date.now();
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  const failedFirstPartyAssets: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const scriptHosts = new Set<string>();
  let blockedMonitorInterference = false;
  let consoleMessageCount = 0;
  let consoleFlooded = false;
  let response: Response | null = null;

  try {
    const inputHost = new URL(url).hostname;
    context = await browser.newContext({
      viewport: { width: config.VIEWPORT_WIDTH, height: config.VIEWPORT_HEIGHT },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
      locale: "en-US",
      timezoneId: "Asia/Jakarta",
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    page = await context.newPage();
    const onConsole = (message: ConsoleMessage) => {
      consoleMessageCount += 1;
      if (message.type() === "error" && consoleErrors.length < MAX_CAPTURED_BROWSER_ERRORS) {
        consoleErrors.push(message.text().slice(0, 180));
      }
      if (consoleMessageCount >= MAX_CONSOLE_MESSAGES) {
        consoleFlooded = true;
        page?.off("console", onConsole);
      }
    };
    page.on("console", onConsole);
    page.on("pageerror", (error) => {
      if (pageErrors.length < MAX_CAPTURED_BROWSER_ERRORS) pageErrors.push(error.message.slice(0, 180));
    });
    page.on("request", (req) => {
      if (req.resourceType() !== "script") return;
      try {
        scriptHosts.add(new URL(req.url()).hostname);
      } catch {
        // Ignore data: and other non-URL script sources.
      }
    });
    page.on("response", (res) => {
      const req = res.request();
      const type = req.resourceType();
      if (res.status() >= 400 && ["script", "stylesheet"].includes(type) && isFirstParty(req.url(), inputHost)) {
        failedFirstPartyAssets.push(`${type}:${res.status()}`);
      }
    });

    await page.route("**/*", async (route) => {
      const request = route.request();
      const type = request.resourceType();
      if (isMonitorInterferenceScript(request.url(), type)) {
        blockedMonitorInterference = true;
        await route.abort();
        return;
      }
      if (["media"].includes(type) || shouldBlockThirdParty(request.url(), inputHost)) {
        await route.abort();
        return;
      }
      await route.continue();
    });

    try {
      // Wait for DOM readiness instead of the full load event. Many healthy pages keep
      // slow analytics/fonts/images open long enough to miss `load`, which caused
      // false DOWN alerts with HTTP unknown.
      response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: config.NAVIGATION_TIMEOUT_MS });
    } catch (error) {
      const timedOut = error instanceof Error && /timeout/i.test(error.message);
      return {
        status: timedOut ? "UNKNOWN" : "FAILING",
        failureCategory: timedOut ? null : "DOWN",
        summary: timedOut ? "Navigation timed out before the monitor could verify the page." : "Page navigation failed.",
        signals: [timedOut ? "navigation_timeout" : "navigation_error"],
        httpStatus: null,
        finalUrl: page.url() || url,
        durationMs: Date.now() - started,
      };
    }

    await delay(config.STABILIZATION_DELAY_MS);

    const httpStatus = response?.status() ?? null;
    const headers = (await response?.allHeaders().catch(() => ({}))) ?? {};
    const finalUrl = page.url();
    const title = await page.title().catch(() => "");
    const visible = await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let visibleElementCount = 0;
      while (walker.nextNode()) {
        const element = walker.currentNode as HTMLElement;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        if (style.visibility !== "hidden" && style.display !== "none" && rect.width > 1 && rect.height > 1) {
          visibleElementCount += 1;
        }
      }
      const text = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim();
      const hasCaptchaWidget = Boolean(
        document.querySelector(
          'iframe[src*="recaptcha"], iframe[src*="hcaptcha.com"], iframe[src*="challenges.cloudflare.com"], iframe[src*="captcha-delivery.com"], .g-recaptcha, .h-captcha, .cf-turnstile',
        ),
      );
      return {
        textLength: text.length,
        sample: text.slice(0, 300),
        blockTextSample: text.slice(0, 2000),
        hasCaptchaWidget,
        visibleElementCount,
      };
    });

    const screenshot = await page.screenshot({ type: "jpeg", quality: 55, fullPage: false });
    const signals = buildSignals({
      httpStatus,
      visible,
      screenshotBytes: screenshot.length,
      failedFirstPartyAssets,
      consoleErrors,
      pageErrors,
      blockedMonitorInterference,
      consoleFlooded,
    });

    const block = detectWebsiteBlock({
      httpStatus,
      headers,
      pageText: `${title}\n${visible.blockTextSample}`,
      textLength: visible.textLength,
      hasCaptchaWidget: visible.hasCaptchaWidget,
    });
    if (block) {
      return {
        status: "BLOCKED",
        failureCategory: null,
        block,
        summary: `Blocked by Website: ${formatWebsiteBlock(block.type, block.provider)}.`,
        signals: [...signals, "website_block"],
        httpStatus,
        finalUrl,
        durationMs: Date.now() - started,
        pageTitle: title,
        visibleTextSample: visible.sample,
      };
    }

    // Error responses show the server's error page, not the client's content, so there is nothing to examine.
    let compromise: CompromiseCheck | null = null;
    if (config.COMPROMISE_DETECTION_ENABLED && (httpStatus === null || httpStatus < 400)) {
      const observation = await collectPageObservation(page).catch((error) => {
        console.warn(`Could not examine ${url} for a Compromise`, error);
        return null;
      });
      if (observation) {
        compromise = assessCompromise({
          inputUrl: url,
          finalUrl,
          observation: { ...observation, title },
          scriptHosts: [...scriptHosts],
          knownScriptSources,
          keywords: {
            spam: config.COMPROMISE_SPAM_KEYWORDS,
            gambling: config.COMPROMISE_GAMBLING_KEYWORDS,
            defacement: config.COMPROMISE_DEFACEMENT_KEYWORDS,
          },
        });
      }
    }

    const deterministic = classifyDeterministic({ httpStatus, visibleText: visible.sample, textLength: visible.textLength, visibleElementCount: visible.visibleElementCount, screenshotBytes: screenshot.length, signals });

    if (deterministic.status === "FAILING") {
      return { ...deterministic, compromise, signals, httpStatus, finalUrl, durationMs: Date.now() - started, screenshot, pageTitle: title, visibleTextSample: visible.sample };
    }

    const needsAi = ai.isEnabled() && isAmbiguousVisualSuspicion(signals);
    if (needsAi) {
      const aiResult = await ai.classify({
        screenshot,
        urlHost: new URL(finalUrl).hostname,
        httpStatus,
        pageTitle: title,
        visibleTextSample: visible.sample,
        suspicionSignals: signals,
      });

      if (aiResult && aiResult.classification !== "OK" && aiResult.confidence >= 0.7) {
        return {
          status: "FAILING",
          failureCategory: aiResult.classification,
          compromise,
          summary: aiResult.reason,
          signals: [...signals, "ai_confirmed"],
          httpStatus,
          finalUrl,
          durationMs: Date.now() - started,
          screenshot,
          pageTitle: title,
          visibleTextSample: visible.sample,
          aiClassification: aiResult.classification,
          aiConfidence: Math.round(aiResult.confidence * 100),
        };
      }
    }

    return {
      status: "OK",
      failureCategory: null,
      compromise,
      summary: signals.length ? `Loaded with non-alerting signals: ${signals.join(", ")}.` : "Page loaded successfully.",
      signals,
      httpStatus,
      finalUrl,
      durationMs: Date.now() - started,
      screenshot,
      pageTitle: title,
      visibleTextSample: visible.sample,
    };
  } finally {
    await page?.close().catch(() => undefined);
    await context?.close().catch(() => undefined);
  }
}

async function collectPageObservation(page: Page) {
  return (await page.evaluate(PAGE_OBSERVATION_SCRIPT)) as Omit<PageObservation, "title">;
}

// Runs in the page. Kept as plain JS in a string because tsx/esbuild's keepNames helpers
// (__name) do not exist in the browser and would break a serialized function with inner helpers.
// Hidden subtrees are collected whole and not descended into.
const PAGE_OBSERVATION_SCRIPT = String.raw`(() => {
  const MAX_TEXT = 50000;
  const MAX_ELEMENTS = 15000;
  const MAX_LINKS = 500;
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG"]);
  const hiddenParts = [];
  let hiddenLength = 0;
  const links = [];
  const frames = [];
  const squash = (text) => (text || "").replace(/\s+/g, " ").trim();

  const pushHidden = (text) => {
    const clean = squash(text);
    if (!clean || hiddenLength >= MAX_TEXT) return;
    hiddenParts.push(clean.slice(0, MAX_TEXT - hiddenLength));
    hiddenLength += clean.length;
  };
  const pushLink = (anchor, hidden) => {
    if (links.length < MAX_LINKS && anchor.href) links.push({ href: anchor.href, text: squash(anchor.textContent).slice(0, 200), hidden });
  };
  // Classic spam-hiding tricks: display/visibility, far off-screen positioning, and 1px clipped boxes.
  const isHidden = (element) => {
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return true;
    const rect = element.getBoundingClientRect();
    if (rect.right < -1000 || rect.bottom < -1000) return true;
    return rect.width <= 1 && rect.height <= 1 && style.overflow === "hidden" && squash(element.textContent).length > 0;
  };
  const isHiddenFrame = (frame) => {
    if (isHidden(frame)) return true;
    const rect = frame.getBoundingClientRect();
    return rect.width <= 2 || rect.height <= 2 || window.getComputedStyle(frame).opacity === "0";
  };

  for (const meta of document.querySelectorAll('meta[name="description"], meta[name="keywords"], meta[property="og:title"], meta[property="og:description"]')) {
    pushHidden(meta.getAttribute("content"));
  }

  let visited = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, {
    acceptNode(element) {
      if (++visited > MAX_ELEMENTS) return NodeFilter.FILTER_REJECT;
      const tag = element.tagName.toUpperCase();
      if (SKIP_TAGS.has(tag)) return NodeFilter.FILTER_REJECT;
      if (tag === "IFRAME") {
        frames.push({ src: element.src, hidden: isHiddenFrame(element) });
        return NodeFilter.FILTER_REJECT;
      }
      if (isHidden(element)) {
        pushHidden(element.textContent);
        for (const anchor of element.querySelectorAll("a[href]")) pushLink(anchor, true);
        for (const frame of element.querySelectorAll("iframe")) frames.push({ src: frame.src, hidden: true });
        if (tag === "A") pushLink(element, true);
        return NodeFilter.FILTER_REJECT;
      }
      if (tag === "A") pushLink(element, false);
      // Text shrunk to nothing (font-size 0/1px) stays in the page for crawlers only.
      if (parseFloat(window.getComputedStyle(element).fontSize) < 2) {
        for (const child of element.childNodes) if (child.nodeType === Node.TEXT_NODE) pushHidden(child.textContent);
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode()) {
    // acceptNode does the work.
  }

  const visibleText = squash(document.body ? document.body.innerText : "");
  return {
    visibleText: visibleText.slice(0, MAX_TEXT),
    visibleTextLength: visibleText.length,
    hiddenText: hiddenParts.join(" \n "),
    links,
    frames,
  };
})()`;

function buildSignals(input: {
  httpStatus: number | null;
  visible: { textLength: number; visibleElementCount: number; sample: string };
  screenshotBytes: number;
  failedFirstPartyAssets: string[];
  consoleErrors: string[];
  pageErrors: string[];
  blockedMonitorInterference: boolean;
  consoleFlooded: boolean;
}) {
  const signals: string[] = [];
  if (input.httpStatus && input.httpStatus >= 400) signals.push(`http_${input.httpStatus}`);
  if (input.visible.textLength < 50) signals.push("low_text");
  if (input.visible.visibleElementCount < 5) signals.push("low_elements");
  if (input.screenshotBytes < 8_000) signals.push("low_visual_complexity");
  if (input.failedFirstPartyAssets.length) signals.push("failed_first_party_css_js");
  if (input.consoleErrors.length || input.pageErrors.length) signals.push("browser_errors");
  if (input.blockedMonitorInterference) signals.push("blocked_monitor_interference");
  if (input.consoleFlooded) signals.push("console_flood");
  if (ERROR_TEXT_RE.test(input.visible.sample)) signals.push("visible_error_text");
  return [...new Set(signals)];
}

function classifyDeterministic(input: {
  httpStatus: number | null;
  visibleText: string;
  textLength: number;
  visibleElementCount: number;
  screenshotBytes: number;
  signals: string[];
}): Pick<CheckOutcome, "status" | "failureCategory" | "summary"> {
  if (input.httpStatus && input.httpStatus >= 500) {
    return { status: "FAILING", failureCategory: "DOWN", summary: `Server returned HTTP ${input.httpStatus}.` };
  }

  if (input.httpStatus && input.httpStatus >= 400) {
    return { status: "FAILING", failureCategory: "ERROR_PAGE", summary: `Page returned HTTP ${input.httpStatus}.` };
  }

  if (input.signals.includes("visible_error_text")) {
    return { status: "FAILING", failureCategory: "ERROR_PAGE", summary: "The page shows visible error or maintenance text." };
  }

  if (input.textLength < 50 && input.visibleElementCount < 5 && input.screenshotBytes < 8_000) {
    return { status: "FAILING", failureCategory: "BLANK", summary: "The page appears mostly blank after loading." };
  }

  if (input.signals.includes("failed_first_party_css_js") && input.textLength < 120 && input.visibleElementCount < 8) {
    return { status: "FAILING", failureCategory: "VISUAL_BROKEN", summary: "First-party CSS/JS failed and the page has very little visible content." };
  }

  return { status: "OK", failureCategory: null, summary: "Page loaded successfully." };
}

function isAmbiguousVisualSuspicion(signals: string[]) {
  return signals.includes("failed_first_party_css_js") || signals.includes("low_visual_complexity") || signals.includes("low_elements") || signals.includes("low_text");
}

function isFirstParty(resourceUrl: string, inputHost: string) {
  try {
    const host = new URL(resourceUrl).hostname;
    return host === inputHost || host.endsWith(`.${inputHost}`);
  } catch {
    return false;
  }
}

function isMonitorInterferenceScript(resourceUrl: string, resourceType: string) {
  if (resourceType !== "script") return false;
  return MONITOR_INTERFERENCE_SCRIPT_PATTERNS.some((pattern) => pattern.test(resourceUrl));
}

function shouldBlockThirdParty(resourceUrl: string, inputHost: string) {
  try {
    const host = new URL(resourceUrl).hostname;
    if (isFirstParty(resourceUrl, inputHost)) return false;
    return BLOCKED_HOST_PATTERNS.some((pattern) => host === pattern || host.endsWith(`.${pattern}`));
  } catch {
    return false;
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(fallback()), ms);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
