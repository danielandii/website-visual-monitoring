import { Form, Link, useActionData, useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/settings";
import { requireAdmin } from "~/lib/auth.server";
import { getEffectiveConfig, saveSettings, sectionKeys } from "~/lib/settings.server";
import { SETTING_SECTIONS } from "~/lib/settings";
import { changeOwnPassword, findUserById, updateProfile } from "~/db/users.server";
import { deleteAllMonitoredUrls, resetLatestResults } from "~/db/monitored-urls.server";
import { Topbar } from "~/components/topbar";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Settings · Website Visual Monitoring" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const me = await requireAdmin(request);
  const [config, user] = await Promise.all([getEffectiveConfig(), findUserById(me.id)]);
  const values: Record<string, { value: string; isSet: boolean }> = {};
  for (const section of SETTING_SECTIONS) {
    for (const field of section.fields) {
      const raw = (config as Record<string, unknown>)[field.env];
      const isSet = raw !== undefined && raw !== null && raw !== "";
      values[field.env] = { value: field.secret || !isSet ? "" : String(raw), isSet };
    }
  }
  return { values, profile: { username: user?.username ?? me.username, name: user?.name ?? me.name, email: user?.email ?? "" } };
}

export async function action({ request }: Route.ActionArgs) {
  const me = await requireAdmin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    if (intent === "save") {
      const section = SETTING_SECTIONS.find((s) => s.key === String(form.get("section")));
      if (!section) throw new Error("Unknown section.");
      const values: Record<string, string> = {};
      for (const field of section.fields) {
        const raw = String(form.get(field.env) ?? "").trim();
        if (field.secret) {
          if (form.get(`clear:${field.env}`) === "on") values[field.env] = "";
          else if (raw) values[field.env] = raw;
        } else {
          values[field.env] = raw;
        }
      }
      // A blank non-secret field means "use the environment default".
      const blank = Object.keys(values).filter((key) => values[key] === "" && !section.fields.find((f) => f.env === key)?.secret);
      for (const key of blank) delete values[key];
      await saveSettings(values, blank);
      return { ok: true, message: "Settings saved. The worker picks them up within about 30 seconds." };
    }

    if (intent === "reset-section") {
      await saveSettings({}, sectionKeys(String(form.get("section"))));
      return { ok: true, message: "Section reset to environment defaults." };
    }

    if (intent === "test-webhook") {
      const url = (await getEffectiveConfig()).DISCORD_WEBHOOK_URL;
      if (!url) throw new Error("No Discord webhook URL is configured.");
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: `✅ Test alert from Website Visual Monitoring, sent by ${me.name}.` }),
      });
      if (!response.ok) throw new Error(`Discord responded with ${response.status}.`);
      return { ok: true, message: "Test alert sent." };
    }

    if (intent === "profile") {
      await updateProfile(me.id, { name: String(form.get("name") ?? ""), email: String(form.get("email") ?? "") });
      return { ok: true, message: "Profile updated." };
    }

    if (intent === "password") {
      const next = String(form.get("next") ?? "");
      if (next.length < 12) throw new Error("New password must be at least 12 characters.");
      if (next !== String(form.get("confirm") ?? "")) throw new Error("New password and confirmation do not match.");
      await changeOwnPassword(me.id, String(form.get("current") ?? ""), next);
      return { ok: true, message: "Password changed." };
    }

    if (intent === "reset-results") {
      await resetLatestResults();
      return { ok: true, message: "Latest results reset." };
    }

    if (intent === "delete-all") {
      await deleteAllMonitoredUrls();
      return { ok: true, message: "All monitored URLs deleted." };
    }

    return { ok: false, message: "Unknown action." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Action failed." };
  }
}

const NAV = [
  ...SETTING_SECTIONS.map((s) => ({ key: s.key, label: s.label })),
  { key: "account", label: "Account" },
  { key: "danger", label: "Danger zone" },
];

export default function Settings() {
  const { values, profile } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [params] = useSearchParams();
  const key = NAV.some((n) => n.key === params.get("section")) ? params.get("section")! : "monitoring";
  const section = SETTING_SECTIONS.find((s) => s.key === key);

  return (
    <>
      <Topbar crumbs={["Admin", "Settings"]} />
      <div className="content">
        <div className="page-head">
          <div>
            <h1>Settings</h1>
            <p>Worker and dashboard configuration. Saved values override the matching environment variable.</p>
          </div>
        </div>

        {actionData?.message ? <div className={actionData.ok ? "notice" : "notice error"} role="status">{actionData.message}</div> : null}

        <div className="settings-grid">
          <nav className="settings-nav">
            {NAV.map((n) => (
              <Link key={n.key} to={`?section=${n.key}`} className={`nav-item ${n.key === key ? "active" : ""}`} style={n.key === "danger" && n.key !== key ? { color: "var(--bad)" } : undefined}>
                {n.label}
              </Link>
            ))}
          </nav>

          {section ? (
            <section className="panel flush">
              <Form method="post" key={section.key}>
                <input type="hidden" name="intent" value="save" />
                <input type="hidden" name="section" value={section.key} />
                <SectionHead title={section.title} desc={section.desc} />
                {section.fields.map((field) => {
                  const current = values[field.env];
                  return (
                    <div className="setting-row" key={field.env}>
                      <div className="setting-label">
                        <span style={{ fontWeight: 500 }}>{field.label}</span>
                        <span className="muted">{field.help}</span>
                        <span className="mono muted small">{field.env}</span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <div className="input-unit">
                          <input
                            name={field.env}
                            type={field.secret ? "password" : "text"}
                            defaultValue={current.value}
                            placeholder={field.secret ? (current.isSet ? "•••••••• (set — leave blank to keep)" : field.placeholder) : undefined}
                            autoComplete="off"
                          />
                          {field.unit ? <span>{field.unit}</span> : null}
                        </div>
                        {field.secret && current.isSet ? (
                          <label className="check-row muted small"><input type="checkbox" name={`clear:${field.env}`} /> Remove saved value</label>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                {section.key === "alerts" ? (
                  <div className="setting-row">
                    <div className="setting-label">
                      <span style={{ fontWeight: 500 }}>Test webhook</span>
                      <span className="muted">Send a test message to the saved channel.</span>
                    </div>
                    <button className="btn" style={{ justifySelf: "end" }} type="submit" form="test-webhook">Send test</button>
                  </div>
                ) : null}
                <div className="setting-foot">
                  <button className="btn" type="submit" form="reset-section">Reset to defaults</button>
                  <button className="btn primary" type="submit">Save changes</button>
                </div>
              </Form>
              <Form method="post" id="reset-section" onSubmit={(e) => !confirm("Reset this section to environment defaults?") && e.preventDefault()}>
                <input type="hidden" name="intent" value="reset-section" />
                <input type="hidden" name="section" value={section.key} />
              </Form>
              <Form method="post" id="test-webhook">
                <input type="hidden" name="intent" value="test-webhook" />
              </Form>
            </section>
          ) : null}

          {key === "account" ? (
            <div className="stack">
              <section className="panel flush">
                <Form method="post">
                  <input type="hidden" name="intent" value="profile" />
                  <SectionHead title="Account" desc="Your profile. Your username cannot be changed." />
                  <div className="setting-row">
                    <div className="setting-label"><span style={{ fontWeight: 500 }}>Username</span></div>
                    <div className="input-unit"><input value={profile.username} readOnly /></div>
                  </div>
                  <div className="setting-row">
                    <div className="setting-label"><span style={{ fontWeight: 500 }}>Name</span></div>
                    <div className="input-unit"><input name="name" defaultValue={profile.name} required /></div>
                  </div>
                  <div className="setting-row">
                    <div className="setting-label"><span style={{ fontWeight: 500 }}>Email</span></div>
                    <div className="input-unit"><input name="email" type="email" defaultValue={profile.email} /></div>
                  </div>
                  <div className="setting-foot"><button className="btn primary" type="submit">Save profile</button></div>
                </Form>
              </section>
              <section className="panel flush">
                <Form method="post">
                  <input type="hidden" name="intent" value="password" />
                  <SectionHead title="Change password" desc="Passwords are stored as salted hashes." />
                  <div className="setting-row">
                    <div className="setting-label"><span style={{ fontWeight: 500 }}>Current password</span></div>
                    <div className="input-unit"><input name="current" type="password" required autoComplete="current-password" /></div>
                  </div>
                  <div className="setting-row">
                    <div className="setting-label"><span style={{ fontWeight: 500 }}>New password</span><span className="muted">At least 12 characters.</span></div>
                    <div className="input-unit"><input name="next" type="password" minLength={12} required autoComplete="new-password" /></div>
                  </div>
                  <div className="setting-row">
                    <div className="setting-label"><span style={{ fontWeight: 500 }}>Confirm new password</span></div>
                    <div className="input-unit"><input name="confirm" type="password" minLength={12} required autoComplete="new-password" /></div>
                  </div>
                  <div className="setting-foot"><button className="btn primary" type="submit">Change password</button></div>
                </Form>
              </section>
            </div>
          ) : null}

          {key === "danger" ? (
            <section className="panel flush" style={{ borderColor: "var(--bad)" }}>
              <SectionHead title="Danger zone" desc="These actions cannot be undone." danger />
              <DangerRow intent="reset-results" title="Reset latest results" help="Set every URL back to UNKNOWN and clear open failure episodes." button="Reset results" confirmText="Reset the latest results for every URL?" />
              <DangerRow intent="delete-all" title="Delete all monitored URLs" help="Removes every URL and its latest check result." button="Delete all" confirmText="Delete ALL monitored URLs?" />
            </section>
          ) : null}
        </div>
      </div>
    </>
  );
}

function SectionHead({ title, desc, danger }: { title: string; desc: string; danger?: boolean }) {
  return (
    <div className="setting-head">
      <span style={{ fontWeight: 600, fontSize: 15, color: danger ? "var(--bad)" : undefined }}>{title}</span>
      <span className="muted">{desc}</span>
    </div>
  );
}

function DangerRow({ intent, title, help, button, confirmText }: { intent: string; title: string; help: string; button: string; confirmText: string }) {
  return (
    <Form method="post" className="setting-row" onSubmit={(e) => !confirm(confirmText) && e.preventDefault()}>
      <input type="hidden" name="intent" value={intent} />
      <div className="setting-label">
        <span style={{ fontWeight: 500 }}>{title}</span>
        <span className="muted">{help}</span>
      </div>
      <button className="btn" style={{ justifySelf: "end", background: "var(--bad)", borderColor: "var(--bad)", color: "#fff" }} type="submit">{button}</button>
    </Form>
  );
}
