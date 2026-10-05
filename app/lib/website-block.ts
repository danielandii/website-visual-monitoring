import type { BlockType } from "~/db/schema";

export const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  CAPTCHA: "CAPTCHA",
  BOT_CHALLENGE: "Bot challenge",
  ACCESS_DENIED: "Access denied",
  RATE_LIMITED: "Rate limited",
};

export function formatWebsiteBlock(type: BlockType | null, provider: string | null) {
  const label = type ? BLOCK_TYPE_LABELS[type] : "Unknown block";
  return `${label} (${provider ?? "Unknown provider"})`;
}
