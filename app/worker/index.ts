import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import type { Browser } from "playwright";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import { type AppConfig } from "~/lib/config.server";
import { getEffectiveConfig } from "~/lib/settings.server";
import { claimNextDueUrl, nextFutureSlot, updateCheckOutcome } from "~/db/monitored-urls.server";
import type { MonitoredUrl } from "~/db/schema";
import { OpenRouterVisualClassifier } from "./ai";
import { checkUrl } from "./checker";
import { DiscordAlertDispatcher } from "./discord";

chromium.use(stealth());

const workerId = `${os.hostname()}-${process.pid}-${Date.now()}`;

async function main() {
  let config = await getEffectiveConfig();
  let ai = new OpenRouterVisualClassifier(config);
  await ai.initialize();
  const discord = new DiscordAlertDispatcher(config);
  const browser = await chromium.launch({ headless: true });
  let active = 0;
  let stopping = false;

  process.on("SIGINT", () => (stopping = true));
  process.on("SIGTERM", () => (stopping = true));

  console.log(`Worker ${workerId} started with max concurrency ${config.MAX_CONCURRENT_CHECKS}`);

  const reloadSettings = async () => {
    try {
      const next = await getEffectiveConfig();
      if (next.OPENROUTER_API_KEY !== config.OPENROUTER_API_KEY || next.OPENROUTER_MODEL !== config.OPENROUTER_MODEL) {
        const nextAi = new OpenRouterVisualClassifier(next);
        await nextAi.initialize();
        ai = nextAi;
      }
      discord.setConfig(next);
      config = next;
    } catch (error) {
      console.warn("Could not reload settings; keeping the previous configuration.", error);
    }
  };
  let lastSettingsReload = Date.now();

  while (!stopping) {
    if (Date.now() - lastSettingsReload >= 30_000) {
      lastSettingsReload = Date.now();
      await reloadSettings();
    }

    if (active >= config.MAX_CONCURRENT_CHECKS) {
      await delay(500);
      continue;
    }

    let due: MonitoredUrl | null;
    try {
      due = await claimNextDueUrl(workerId, config.CHECK_STALE_CLAIM_SECONDS);
    } catch (error) {
      console.error("Failed to claim next due URL; retrying worker loop", error);
      await delay(5_000);
      continue;
    }

    if (!due) {
      await delay(1_000);
      continue;
    }

    active += 1;
    void processUrl(due, config, ai, discord, browser)
      .catch((error) => console.error(`Check failed for ${due.url}`, error))
      .finally(() => {
        active -= 1;
      });
  }

  while (active > 0) await delay(250);
  await browser.close();
}

async function processUrl(
  monitoredUrl: MonitoredUrl,
  config: AppConfig,
  ai: OpenRouterVisualClassifier,
  discord: DiscordAlertDispatcher,
  browser: Browser,
) {
  const first = await checkUrl(browser, monitoredUrl.url, config, ai);
  let final = first;

  if (first.status !== "OK") {
    await delay(config.CONFIRMATION_RETRY_DELAY_MS);
    const retry = await checkUrl(browser, monitoredUrl.url, config, ai);
    final = combineConfirmationAttempts(first, retry);
  }

  const checkedAt = new Date();
  const nextCheckAt = nextFutureSlot(monitoredUrl.nextCheckAt, config.CHECK_CADENCE_MINUTES, checkedAt);
  let alertSentAt = monitoredUrl.alertSentAt;

  if (final.status === "FAILING" && !monitoredUrl.alertSentAt) {
    const sent = await discord.sendFailureAlert(monitoredUrl, final);
    alertSentAt = sent ? checkedAt : null;
  }

  await updateCheckOutcome({
    id: monitoredUrl.id,
    previous: monitoredUrl,
    status: final.status,
    failureCategory: final.failureCategory,
    summary: final.summary,
    signals: final.signals,
    httpStatus: final.httpStatus,
    finalUrl: final.finalUrl,
    durationMs: final.durationMs,
    aiClassification: final.aiClassification,
    aiConfidence: final.aiConfidence,
    checkedAt,
    nextCheckAt,
    alertSentAt,
  });

  console.log(`${monitoredUrl.url} -> ${final.status}${final.failureCategory ? `/${final.failureCategory}` : ""}`);
}

function combineConfirmationAttempts(first: Awaited<ReturnType<typeof checkUrl>>, retry: Awaited<ReturnType<typeof checkUrl>>) {
  const signals = [...new Set([...first.signals, ...retry.signals, "confirmation_retry"])] as string[];
  const summary = `Attempt 1: ${formatAttempt(first)}. Retry: ${retry.summary}`;

  if (retry.status === "OK") {
    return { ...retry, summary, signals };
  }

  if (first.status === "FAILING" && retry.status === "FAILING") {
    return { ...retry, summary, signals };
  }

  return {
    ...retry,
    status: "UNKNOWN" as const,
    failureCategory: null,
    summary: `Inconclusive after retry. ${summary}`,
    signals,
  };
}

function formatAttempt(outcome: Awaited<ReturnType<typeof checkUrl>>) {
  return `${outcome.status}${outcome.failureCategory ? `/${outcome.failureCategory}` : ""} - ${outcome.summary}`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
