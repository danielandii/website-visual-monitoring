import type { AppConfig } from "./config.server";

export type WebhookPayload = { content: string; allowed_mentions: { parse: []; roles?: string[] } };

export function buildWebhookPayload(content: string, config: Pick<AppConfig, "DISCORD_ALERT_ROLE_ID">): WebhookPayload {
  const roleId = config.DISCORD_ALERT_ROLE_ID;
  return {
    content: roleId ? `${content}\n<@&${roleId}>` : content,
    allowed_mentions: { parse: [], ...(roleId ? { roles: [roleId] } : {}) },
  };
}
