import { Form, useActionData, useLoaderData, useNavigate, useNavigation } from "react-router";
import type { Route } from "./+types/domains";
import { requireAdmin } from "~/lib/auth.server";
import {
  findDomainById,
  listMonitoredDomainsWithUrls,
  setManualExpiration,
  syncMonitoredDomainsFromUrls,
} from "~/db/monitored-domains.server";
import { getEffectiveConfig } from "~/lib/settings.server";
import { DiscordAlertDispatcher } from "~/worker/discord";
import { runExpirySweep } from "~/worker/expiry-sweep";
import { Topbar } from "~/components/topbar";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Domains · Website Visual Monitoring" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  await syncMonitoredDomainsFromUrls();
  return { domains: await listMonitoredDomainsWithUrls() };
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    if (intent === "set-manual") {
      const id = Number(form.get("id"));
      const raw = String(form.get("manualExpiresAt") ?? "").trim();
      const parsed = raw ? new Date(`${raw}T00:00:00Z`) : null;
      if (raw && (!parsed || Number.isNaN(parsed.getTime()))) throw new Error("Invalid date.");
      await setManualExpiration(id, parsed);
      return { ok: true, message: "Manual expiration updated." };
    }
    if (intent === "accept-rdap") {
      const id = Number(form.get("id"));
      const domain = await findDomainById(id);
      if (!domain) throw new Error("Domain not found.");
      await setManualExpiration(id, null);
      return { ok: true, message: `Manual value cleared; RDAP value will be used.` };
    }
    if (intent === "refresh") {
      const config = await getEffectiveConfig();
      const discord = new DiscordAlertDispatcher(config);
      const result = await runExpirySweep(discord, { signal: request.signal });
      const message = result.stopped
        ? `RDAP sweep stopped after ${result.processed} of ${result.total} domain(s).`
        : `RDAP sweep complete (${result.total} domain(s)).`;
      return { ok: true, message };
    }
    return { ok: false, message: "Unknown action." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Action failed." };
  }
}

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

function toInputValue(d: Date | null) {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

function daysUntil(d: Date | null) {
  if (!d) return null;
  return Math.floor((d.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function countdownLabel(d: Date | null) {
  const days = daysUntil(d);
  if (days === null) return "—";
  if (days < 0) return `expired ${Math.abs(days)}d ago`;
  if (days === 0) return "expires today";
  return `in ${days}d`;
}

function countdownColor(d: Date | null): string | undefined {
  const days = daysUntil(d);
  if (days === null) return undefined;
  if (days <= 7) return "var(--bad)";
  if (days <= 30) return "var(--warn, #b7791f)";
  return undefined;
}

const GRID = "minmax(180px, 1.6fr) minmax(170px, 1.2fr) 70px 60px minmax(200px, 1fr) 70px";

export default function Domains() {
  const { domains } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const refreshing =
    navigation.state !== "idle" && navigation.formData?.get("intent") === "refresh";

  return (
    <>
      <Topbar crumbs={["Admin", "Domains"]} />
      <div className="content">
        <div className="page-head">
          <div>
            <h1>Domains</h1>
            <p>Registration expiration per registrable domain. Alerts fire at 30 / 14 / 7 / 1 / 0 days.</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {refreshing ? (
              <button
                className="btn"
                type="button"
                onClick={() => navigate(".", { replace: true })}
                title="Cancels the in-flight sweep. Progress so far is saved."
              >
                Stop
              </button>
            ) : null}
            <Form method="post" onSubmit={(e) => !confirm("Run RDAP lookup for every domain now? This may also send Domain Expiry Alerts for any threshold that has not been sent yet.") && e.preventDefault()}>
              <input type="hidden" name="intent" value="refresh" />
              <button className="btn primary" type="submit" disabled={refreshing} aria-busy={refreshing}>
                {refreshing ? `Refreshing ${domains.length} domain${domains.length === 1 ? "" : "s"}…` : "Refresh now"}
              </button>
            </Form>
          </div>
        </div>

        {actionData?.message ? (
          <div className={actionData.ok ? "notice" : "notice error"} role="status">{actionData.message}</div>
        ) : null}

        {domains.length === 0 ? (
          <p className="muted">No monitored domains yet. Add a Monitored URL first.</p>
        ) : (
          <section className="panel flush">
            <div className="table-scroll">
              <div className="table" style={{ minWidth: 900 }}>
                <div className="tr th" style={{ display: "grid", gridTemplateColumns: GRID, gap: 10 }}>
                  <span>Domain</span>
                  <span>Expires</span>
                  <span>Source</span>
                  <span>URLs</span>
                  <span>Manual override</span>
                  <span>Sent</span>
                </div>
                {domains.map((d) => {
                  const rdapDisagrees =
                    d.manualExpiresAt && d.rdapExpiresAt && d.manualExpiresAt.getTime() !== d.rdapExpiresAt.getTime();
                  const urlsTitle = d.urls.length
                    ? d.urls.map((u) => `${u.name} — ${u.url}${u.enabled ? "" : " (disabled)"}`).join("\n")
                    : "No URLs";
                  return (
                    <div
                      key={d.id}
                      className="tr"
                      style={{ display: "grid", gridTemplateColumns: GRID, gap: 10, alignItems: "center" }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                        <span className="mono" style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" }}>
                          {d.registrableDomain}
                        </span>
                        {d.lastLookupError ? (
                          <span className="muted small" style={{ color: "var(--bad)" }} title={d.lastLookupError}>
                            ⚠ Lookup failed
                          </span>
                        ) : null}
                      </div>

                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <span style={{ color: countdownColor(d.expiresAt) }}>
                          {d.expiresAt ? dateFormat.format(d.expiresAt) : "—"}
                        </span>
                        <span className="muted small" style={{ color: countdownColor(d.expiresAt) }}>
                          {countdownLabel(d.expiresAt)}
                        </span>
                      </div>

                      <span className="small">{d.expiresAtSource}</span>

                      <span className="small" title={urlsTitle} style={{ cursor: "help" }}>
                        {d.urls.length}
                      </span>

                      <Form method="post" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input type="hidden" name="intent" value="set-manual" />
                        <input type="hidden" name="id" value={d.id} />
                        <input
                          type="date"
                          name="manualExpiresAt"
                          defaultValue={toInputValue(d.manualExpiresAt)}
                          className="inline-input"
                          style={{ minWidth: 130 }}
                        />
                        <button className="btn xs" type="submit">Save</button>
                        {rdapDisagrees ? (
                          <button
                            className="link-btn small"
                            type="submit"
                            formAction="?"
                            name="intent"
                            value="accept-rdap"
                            title={`RDAP reports ${dateFormat.format(d.rdapExpiresAt!)}. Click to clear manual override.`}
                          >
                            Use RDAP
                          </button>
                        ) : null}
                      </Form>

                      <span className="mono small" title="Thresholds already sent this registration period">
                        {d.sentThresholds.length ? d.sentThresholds.join(",") : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
