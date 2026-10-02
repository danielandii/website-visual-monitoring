import { inArray } from "drizzle-orm";
import { getDb, withDbRetry } from "~/db/client.server";
import { appSettings } from "~/db/schema";
import { ConfigSchema, type AppConfig } from "./config.server";
import { SETTING_KEYS, SETTING_SECTIONS } from "./settings";

export async function loadOverrides() {
  const rows = await withDbRetry(() => getDb().select().from(appSettings), { label: "load settings" });
  const overrides: Record<string, string | undefined> = {};
  for (const row of rows) {
    if (SETTING_KEYS.has(row.key)) overrides[row.key] = row.value === "" ? undefined : row.value;
  }
  return overrides;
}

function parse(env: NodeJS.ProcessEnv, overrides: Record<string, string | undefined>): AppConfig {
  return ConfigSchema.parse({ ...env, ...overrides });
}

/** Environment defaults overlaid with values saved from the Settings page. */
export async function getEffectiveConfig(): Promise<AppConfig> {
  return parse(process.env, await loadOverrides());
}

export async function saveSettings(values: Record<string, string>, resetKeys: string[] = []) {
  const overrides = await loadOverrides();
  const candidate = { ...overrides };
  for (const key of resetKeys) delete candidate[key];
  for (const [key, value] of Object.entries(values)) candidate[key] = value === "" ? undefined : value;

  const result = ConfigSchema.safeParse({ ...process.env, ...candidate });
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`Invalid value for ${issue.path.join(".")}: ${issue.message}`);
  }

  const db = getDb();
  if (resetKeys.length) await db.delete(appSettings).where(inArray(appSettings.key, resetKeys));
  for (const [key, value] of Object.entries(values)) {
    if (!SETTING_KEYS.has(key)) continue;
    await db
      .insert(appSettings)
      .values({ key, value })
      .onDuplicateKeyUpdate({ set: { value } });
  }
}

export function sectionKeys(sectionKey: string) {
  return SETTING_SECTIONS.find((section) => section.key === sectionKey)?.fields.map((field) => field.env) ?? [];
}
