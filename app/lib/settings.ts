export type SettingField = {
  env: string;
  label: string;
  help: string;
  unit?: string;
  secret?: boolean;
  placeholder?: string;
};

export type SettingSection = {
  key: string;
  label: string;
  title: string;
  desc: string;
  fields: SettingField[];
};

export const SETTING_SECTIONS: SettingSection[] = [
  {
    key: "monitoring",
    label: "Check cadence",
    title: "Check cadence & spacing",
    desc: "How often each Monitored URL is checked and how many run at once.",
    fields: [
      { env: "CHECK_CADENCE_MINUTES", label: "Check cadence", help: "Intended time between checks for the same URL.", unit: "min" },
      { env: "MAX_CONCURRENT_CHECKS", label: "Max concurrent checks", help: "Upper bound on parallel browser checks." },
      { env: "CHECK_STALE_CLAIM_SECONDS", label: "Stale claim timeout", help: "Release a claimed check if the worker stops responding.", unit: "sec" },
    ],
  },
  {
    key: "viewport",
    label: "Viewport",
    title: "Viewport",
    desc: "Browser screen size used when visually checking a URL. Mobile by default.",
    fields: [
      { env: "VIEWPORT_WIDTH", label: "Width", help: "Viewport width in CSS pixels.", unit: "px" },
      { env: "VIEWPORT_HEIGHT", label: "Height", help: "Viewport height in CSS pixels.", unit: "px" },
    ],
  },
  {
    key: "timeouts",
    label: "Timeouts & retries",
    title: "Timeouts & retries",
    desc: "Limits for each check and the delay before a Confirmation Retry.",
    fields: [
      { env: "NAVIGATION_TIMEOUT_MS", label: "Navigation timeout", help: "Fail the navigation if the page has not loaded.", unit: "ms" },
      { env: "TOTAL_CHECK_TIMEOUT_MS", label: "Total check timeout", help: "Hard limit for the whole check.", unit: "ms" },
      { env: "STABILIZATION_DELAY_MS", label: "Stabilization delay", help: "Wait after load before evaluating the page.", unit: "ms" },
      { env: "CONFIRMATION_RETRY_DELAY_MS", label: "Confirmation retry delay", help: "Delay before re-checking a suspected failure.", unit: "ms" },
    ],
  },
  {
    key: "alerts",
    label: "Discord alerts",
    title: "Discord alerts",
    desc: "One Alert is sent per Failure Episode. Recoveries are not announced.",
    fields: [
      { env: "DISCORD_WEBHOOK_URL", label: "Webhook URL", help: "Discord channel webhook that receives alerts.", secret: true, placeholder: "https://discord.com/api/webhooks/…" },
      { env: "DISCORD_ALERTS_PER_MINUTE", label: "Alert rate limit", help: "Maximum alerts sent per minute to prevent flooding.", unit: "/min" },
    ],
  },
  {
    key: "ai",
    label: "AI review",
    title: "AI visual review",
    desc: "OpenRouter is used only for ambiguous checks after deterministic signals.",
    fields: [
      { env: "OPENROUTER_API_KEY", label: "API key", help: "Leave empty to disable AI review.", secret: true, placeholder: "sk-or-…" },
      { env: "OPENROUTER_MODEL", label: "Model", help: "Vision-capable model used for review." },
    ],
  },
];

export const SETTING_FIELDS = SETTING_SECTIONS.flatMap((section) => section.fields);
export const SETTING_KEYS = new Set(SETTING_FIELDS.map((field) => field.env));
