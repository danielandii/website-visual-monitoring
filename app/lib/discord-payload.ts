import type { AppConfig } from "./config.server";

export type WebhookPayload = {
  content: string;
  allowed_mentions: { parse: []; roles?: string[]; users?: string[] };
};

export function buildWebhookPayload(content: string, config: Pick<AppConfig, "DISCORD_ALERT_ROLE_ID">): WebhookPayload {
  const roleId = config.DISCORD_ALERT_ROLE_ID;
  return {
    content: roleId ? `${content}\n<@&${roleId}>` : content,
    allowed_mentions: { parse: [], ...(roleId ? { roles: [roleId] } : {}) },
  };
}

export type ExpiryMention = { kind: "role" | "user"; id: string };

export function parseExpiryMentions(raw: string | undefined | null): ExpiryMention[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [kind, id] = entry.split(":");
      return { kind: kind as "role" | "user", id };
    });
}

export function buildExpiryWebhookPayload(content: string, mentions: ExpiryMention[]): WebhookPayload {
  const mentionTags = mentions.map((m) => (m.kind === "role" ? `<@&${m.id}>` : `<@${m.id}>`)).join(" ");
  const roles = mentions.filter((m) => m.kind === "role").map((m) => m.id);
  const users = mentions.filter((m) => m.kind === "user").map((m) => m.id);
  return {
    content: mentionTags ? `${content}\n${mentionTags}` : content,
    allowed_mentions: {
      parse: [],
      ...(roles.length ? { roles } : {}),
      ...(users.length ? { users } : {}),
    },
  };
}
