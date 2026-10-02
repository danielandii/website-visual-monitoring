import type { AppConfig } from "~/lib/config.server";
import type { MonitoredUrl } from "~/db/schema";
import type { CheckOutcome } from "./types";

export class DiscordAlertDispatcher {
  private sentInWindow = 0;
  private windowStartedAt = Date.now();
  private suppressed = 0;

  constructor(private config: AppConfig) {}

  setConfig(config: AppConfig) {
    this.config = config;
  }

  async sendFailureAlert(monitoredUrl: MonitoredUrl, outcome: CheckOutcome) {
    if (!this.config.DISCORD_WEBHOOK_URL) {
      console.warn("DISCORD_WEBHOOK_URL not configured; alert not sent.");
      return false;
    }

    if (!this.consumeRateLimit()) {
      this.suppressed += 1;
      if (this.suppressed === 1) {
        await this.post(`⚠️ Discord alert rate limit reached. Additional failures will be summarized after the current minute.`);
      }
      return false;
    }

    const fields = [
      `URL: ${monitoredUrl.url}`,
      `Category: ${outcome.failureCategory ?? "UNKNOWN"}`,
      `HTTP: ${outcome.httpStatus ?? "unknown"}`,
      `Checked: ${new Date().toISOString()}`,
      `Viewport: mobile ${this.config.VIEWPORT_WIDTH}x${this.config.VIEWPORT_HEIGHT}`,
      `Summary: ${outcome.summary}`,
      `Signals: ${outcome.signals.join(", ") || "none"}`,
    ];

    if (outcome.aiClassification) {
      fields.push(`AI: ${outcome.aiClassification}, confidence ${((outcome.aiConfidence ?? 0) / 100).toFixed(2)}`);
    }

    const ok = await this.post(`🚨 **Website monitor detected a confirmed failure**\n\n${fields.join("\n")}`);
    if (this.suppressed > 0) {
      const count = this.suppressed;
      this.suppressed = 0;
      await this.post(`⚠️ ${count} additional monitored URL failure alert(s) were rate-limited. Check the dashboard for latest status.`);
    }
    return ok;
  }

  private consumeRateLimit() {
    const now = Date.now();
    if (now - this.windowStartedAt >= 60_000) {
      this.windowStartedAt = now;
      this.sentInWindow = 0;
    }
    if (this.sentInWindow >= this.config.DISCORD_ALERTS_PER_MINUTE) return false;
    this.sentInWindow += 1;
    return true;
  }

  private async post(content: string) {
    if (!this.config.DISCORD_WEBHOOK_URL) return false;
    const response = await fetch(this.config.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!response.ok) {
      console.warn(`Discord webhook failed: ${response.status} ${await response.text()}`);
      return false;
    }
    return true;
  }
}
