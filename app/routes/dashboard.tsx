import { useEffect, useRef, useState } from "react";
import { Form, useActionData, useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/dashboard";
import { requireAdmin, requireUser } from "~/lib/auth.server";
import { getEffectiveConfig } from "~/lib/settings.server";
import { Topbar } from "~/components/topbar";
import {
  createMonitoredUrl,
  deleteMonitoredUrl,
  importMonitoredUrlsCsv,
  listMonitoredUrls,
  setMonitoredUrlEnabled,
  updateMonitoredUrl,
} from "~/db/monitored-urls.server";
import { hostnameForDisplay } from "~/lib/url";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Website Visual Monitoring" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const [urls, config] = await Promise.all([listMonitoredUrls(), getEffectiveConfig()]);
  return {
    urls,
    canEdit: user.role === "ADMIN",
    cadenceMinutes: config.CHECK_CADENCE_MINUTES,
    maxConcurrent: config.MAX_CONCURRENT_CHECKS,
    navigationTimeoutMs: config.NAVIGATION_TIMEOUT_MS,
    totalTimeoutMs: config.TOTAL_CHECK_TIMEOUT_MS,
  };
}

export async function action({ request }: Route.ActionArgs) {
  await requireAdmin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  try {
    if (intent === "add") {
      await createMonitoredUrl({
        name: String(formData.get("name") ?? ""),
        url: String(formData.get("url") ?? ""),
        enabled: formData.get("enabled") === "on",
      });
      return { ok: true, message: "Monitored URL added." };
    }

    if (intent === "update") {
      await updateMonitoredUrl({
        id: Number(formData.get("id")),
        name: String(formData.get("name") ?? ""),
        url: String(formData.get("url") ?? ""),
        enabled: formData.get("enabled") === "on",
      });
      return { ok: true, message: "Monitored URL updated." };
    }

    if (intent === "toggle") {
      await setMonitoredUrlEnabled(Number(formData.get("id")), formData.get("enabled") !== "true");
      return { ok: true, message: "Monitoring state changed." };
    }

    if (intent === "delete") {
      await deleteMonitoredUrl(Number(formData.get("id")));
      return { ok: true, message: "Monitored URL deleted." };
    }

    if (intent === "import") {
      const file = formData.get("csv");
      const csv = file instanceof File ? await file.text() : String(formData.get("csvText") ?? "");
      const result = await importMonitoredUrlsCsv(csv, (await getEffectiveConfig()).CHECK_CADENCE_MINUTES);
      return {
        ok: true,
        message: `Imported ${result.imported}. Skipped duplicates ${result.skippedDuplicates}. Invalid ${result.invalid}.`,
      };
    }

    return { ok: false, message: "Unknown action." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Action failed." };
  }
}

type Filter = "All" | "OK" | "FAILING" | "UNKNOWN" | "Disabled";
type View = "overview" | "urls" | "detail";

const PAGE_SIZE = 20;

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "All", label: "All" },
  { key: "OK", label: "OK" },
  { key: "FAILING", label: "Failing" },
  { key: "UNKNOWN", label: "Unknown" },
  { key: "Disabled", label: "Disabled" },
];

export default function Dashboard() {
  const { urls, canEdit, cadenceMinutes, maxConcurrent, navigationTimeoutMs, totalTimeoutMs } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const addRef = useRef<HTMLDialogElement>(null);
  const importRef = useRef<HTMLDialogElement>(null);

  const rawView = params.get("view");
  const selectedId = Number(params.get("id")) || null;
  const rawFilter = params.get("filter") as Filter | null;
  const filter: Filter = FILTERS.some((f) => f.key === rawFilter) ? (rawFilter as Filter) : "All";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const view: View = rawView === "detail" ? "detail" : rawView === "urls" ? "urls" : "overview";

  useEffect(() => {
    if (actionData?.ok) {
      addRef.current?.close();
      importRef.current?.close();
    }
  }, [actionData]);

  const count = (status: string) => urls.filter((u) => u.latestStatus === status).length;
  const ok = count("OK");
  const failing = count("FAILING");
  const unknown = count("UNKNOWN");
  const total = urls.length;
  const selected = urls.find((u) => u.id === selectedId) ?? null;
  const activeView: View = view === "detail" && !selected ? "urls" : view;

  const open = (id: number) => setParams({ view: "detail", id: String(id) });
  const showUrls = (next: Filter = "All") => setParams(next === "All" ? { view: "urls" } : { view: "urls", filter: next });
  const setFilter = (next: Filter) => showUrls(next);
  const setPage = (next: number) =>
    setParams((prev) => {
      const nextParams = new URLSearchParams(prev);
      if (next <= 1) nextParams.delete("page");
      else nextParams.set("page", String(next));
      return nextParams;
    });
  const changeQuery = (next: string) => {
    setQuery(next);
    setPage(1);
  };

  const crumbs =
    activeView === "overview" ? ["Overview"] : activeView === "urls" ? ["Monitored URLs"] : ["Monitored URLs", selected?.name ?? ""];

  return (
    <>
      <Topbar crumbs={crumbs} note={`Checks every ${cadenceMinutes}m`} />
      <div className="content">
        {actionData?.message ? (
          <div className={actionData.ok ? "notice" : "notice error"} role="status">{actionData.message}</div>
        ) : null}

        {activeView === "overview" ? (
          <Overview
            urls={urls}
            canEdit={canEdit}
            counts={{ total, ok, failing, unknown }}
            cadenceMinutes={cadenceMinutes}
            maxConcurrent={maxConcurrent}
            navigationTimeoutMs={navigationTimeoutMs}
            totalTimeoutMs={totalTimeoutMs}
            onFilter={showUrls}
            onOpen={open}
            onAdd={() => addRef.current?.showModal()}
            onImport={() => importRef.current?.showModal()}
          />
        ) : null}

        {activeView === "urls" ? (
          <UrlList
            urls={urls}
            canEdit={canEdit}
            filter={filter}
            query={query}
            page={page}
            counts={{ total, ok, failing, unknown }}
            onFilter={setFilter}
            onQuery={changeQuery}
            onPage={setPage}
            onOpen={open}
            onAdd={() => addRef.current?.showModal()}
            onImport={() => importRef.current?.showModal()}
          />
        ) : null}

        {activeView === "detail" && selected ? (
          <Detail url={selected} canEdit={canEdit} cadenceMinutes={cadenceMinutes} onBack={() => setParams({ view: "urls" })} />
        ) : null}
      </div>

      {canEdit ? (
        <>
      <dialog ref={addRef} className="modal" onClick={(e) => e.target === addRef.current && addRef.current?.close()}>
        <Form method="post">
          <input type="hidden" name="intent" value="add" />
          <div className="modal-head">
            <strong>Add a monitored URL</strong>
            <span className="muted">Use public URLs only. Checks run in the default mobile viewport.</span>
          </div>
          <div className="modal-body">
            <label className="field">Name<input name="name" placeholder="Client homepage" required /></label>
            <label className="field">URL<input className="mono" name="url" placeholder="https://example.com" type="url" required /></label>
            <label className="check-row"><input name="enabled" type="checkbox" defaultChecked /> Enabled</label>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn" onClick={() => addRef.current?.close()}>Cancel</button>
            <button type="submit" className="btn primary">Add URL</button>
          </div>
        </Form>
      </dialog>

      <dialog ref={importRef} className="modal" onClick={(e) => e.target === importRef.current && importRef.current?.close()}>
        <Form method="post" encType="multipart/form-data">
          <input type="hidden" name="intent" value="import" />
          <div className="modal-head">
            <strong>CSV import</strong>
            <span className="muted">
              Columns: <code>name,url,enabled</code>. Duplicate URLs are skipped.
            </span>
          </div>
          <div className="modal-body">
            <div className="drop">
              <span style={{ fontWeight: 500 }}>Choose a .csv file</span>
              <input name="csv" type="file" accept=".csv,text/csv" required />
            </div>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn" onClick={() => importRef.current?.close()}>Cancel</button>
            <button type="submit" className="btn primary">Import CSV</button>
          </div>
        </Form>
      </dialog>
        </>
      ) : null}
    </>
  );
}

type UrlRow = ReturnType<typeof useLoaderData<typeof loader>>["urls"][number];
type Counts = { total: number; ok: number; failing: number; unknown: number };

function PageHead({ title, subtitle, canEdit, onAdd, onImport }: { title: string; subtitle: string; canEdit: boolean; onAdd: () => void; onImport: () => void }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {canEdit ? (
        <div className="actions">
          <button className="btn" onClick={onImport}>Import CSV</button>
          <button className="btn primary" onClick={onAdd}>Add URL</button>
        </div>
      ) : null}
    </div>
  );
}

function Overview(props: {
  canEdit: boolean;
  urls: UrlRow[];
  counts: Counts;
  cadenceMinutes: number;
  maxConcurrent: number;
  navigationTimeoutMs: number;
  totalTimeoutMs: number;
  onFilter: (filter: Filter) => void;
  onOpen: (id: number) => void;
  onAdd: () => void;
  onImport: () => void;
}) {
  const { urls, counts, cadenceMinutes, maxConcurrent, navigationTimeoutMs, totalTimeoutMs } = props;
  const pct = (n: number) => (counts.total ? Math.round((n / counts.total) * 100) : 0);
  const dist = [
    { label: "OK", count: counts.ok, color: "var(--ok)" },
    { label: "Failing", count: counts.failing, color: "var(--bad)" },
    { label: "Unknown", count: counts.unknown, color: "var(--line-strong)" },
  ];

  const failingUrls = urls.filter((u) => u.latestStatus === "FAILING");
  const categories = new Map<string, number>();
  for (const u of failingUrls) {
    const key = u.latestFailureCategory ?? "UNCATEGORIZED";
    categories.set(key, (categories.get(key) ?? 0) + 1);
  }
  const catRows = [...categories.entries()].sort((a, b) => b[1] - a[1]);

  const timed = urls.filter((u) => u.latestDurationMs != null).slice(0, 14);
  const queue = urls
    .filter((u) => u.enabled)
    .sort((a, b) => new Date(a.nextCheckAt).getTime() - new Date(b.nextCheckAt).getTime())
    .slice(0, 6);
  const disabled = urls.filter((u) => !u.enabled).length;

  return (
    <>
      <PageHead
        title="Overview"
        subtitle="Latest check result for every monitored URL."
        canEdit={props.canEdit}
        onAdd={props.onAdd}
        onImport={props.onImport}
      />

      <section className="metrics" aria-label="Monitoring summary">
        <Metric label="Monitored URLs" value={counts.total} sub={`${disabled} disabled`} onClick={() => props.onFilter("All")} />
        <Metric label="OK" value={counts.ok} tone="ok" sub={`${pct(counts.ok)}% of total`} onClick={() => props.onFilter("OK")} />
        <Metric label="Failing" value={counts.failing} tone="bad" sub={`${pct(counts.failing)}% of total`} onClick={() => props.onFilter("FAILING")} />
        <Metric label="Unknown" value={counts.unknown} sub="Not checked yet" onClick={() => props.onFilter("UNKNOWN")} />
        <Metric label="Cadence" value={`${cadenceMinutes}m`} sub="Per URL" />
      </section>

      <div className="grid-2">
        <section className="panel pad">
          <div className="panel-head">
            <strong>Status distribution</strong>
            <span className="muted small">{counts.total} URLs</span>
          </div>
          <div className="dist-bar">
            {dist.filter((d) => d.count > 0).map((d) => (
              <div key={d.label} style={{ width: `${pct(d.count)}%`, background: d.color }} />
            ))}
          </div>
          <div className="legend">
            {dist.map((d) => (
              <div key={d.label}>
                <span className="sw" style={{ background: d.color }} />
                <span className="name">{d.label}</span>
                <span className="val">{d.count} · {pct(d.count)}%</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel pad">
          <div className="panel-head">
            <strong>Failure categories</strong>
            <span className="muted small">Current failing URLs</span>
          </div>
          {catRows.length === 0 ? <p className="muted" style={{ margin: 0 }}>No failing URLs.</p> : null}
          {catRows.map(([label, n]) => (
            <div className="cat-row" key={label}>
              <span className="name">{label}</span>
              <div className="track"><div style={{ width: `${(n / failingUrls.length) * 100}%` }} /></div>
              <span className="num">{n}</span>
            </div>
          ))}
        </section>
      </div>

      <section className="panel pad">
        <div className="panel-head">
          <strong>Latest check duration</strong>
          <div className="chart-key">
            <span><i className="total" />Total timeout {totalTimeoutMs / 1000}s</span>
            <span><i />Navigation timeout {navigationTimeoutMs / 1000}s</span>
          </div>
        </div>
        {timed.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No checks completed yet.</p>
        ) : (
          <>
            <div className="chart">
              <div className="ref total" />
              <div className="ref" style={{ top: "auto", bottom: `${(navigationTimeoutMs / totalTimeoutMs) * 100}%` }} />
              {timed.map((u) => (
                <button
                  key={u.id}
                  className="col"
                  title={`${u.name}: ${((u.latestDurationMs ?? 0) / 1000).toFixed(1)}s`}
                  onClick={() => props.onOpen(u.id)}
                >
                  <div
                    style={{
                      height: `${Math.min(100, ((u.latestDurationMs ?? 0) / totalTimeoutMs) * 100)}%`,
                      background: u.latestStatus === "FAILING" ? "var(--bad)" : "var(--ok)",
                    }}
                  />
                </button>
              ))}
            </div>
            <div className="chart-labels">
              {timed.map((u) => <span key={u.id}>{u.name.split(/[\s—-]/)[0]}</span>)}
            </div>
          </>
        )}
      </section>

      <div className="grid-2">
        <section className="panel flush">
          <div className="panel-head">
            <strong>Open failure episodes</strong>
            <span className="muted small">One alert per episode</span>
          </div>
          {failingUrls.length === 0 ? <div className="empty">No open failures.</div> : null}
          {failingUrls.map((u) => (
            <button key={u.id} className="list-row" onClick={() => props.onOpen(u.id)}>
              <span style={{ fontWeight: 500 }}>{u.name}</span>
              <span className="tag">{u.latestFailureCategory ?? "FAILING"}</span>
              <span className="muted small">Since {formatDate(u.failureStartedAt)}</span>
              <span className="muted small">{u.alertSentAt ? `Alerted ${formatDate(u.alertSentAt)}` : "No alert sent"}</span>
            </button>
          ))}
        </section>

        <section className="panel flush">
          <div className="panel-head">
            <strong>Check queue</strong>
            <span className="muted small">Up to {maxConcurrent} concurrent</span>
          </div>
          {queue.length === 0 ? <div className="empty">Nothing scheduled.</div> : null}
          {queue.map((u) => (
            <div key={u.id} className="list-row" style={{ alignItems: "center" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <span className="mono muted small" style={{ marginRight: 12 }}>{formatTime(u.nextCheckAt)}</span>
                {u.name}
              </span>
              <span className={`pill ${u.latestStatus.toLowerCase()}`}>{u.latestStatus}</span>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}

function UrlList(props: {
  canEdit: boolean;
  urls: UrlRow[];
  filter: Filter;
  query: string;
  page: number;
  counts: Counts;
  onFilter: (filter: Filter) => void;
  onQuery: (query: string) => void;
  onPage: (page: number) => void;
  onOpen: (id: number) => void;
  onAdd: () => void;
  onImport: () => void;
}) {
  const { urls, filter, query, counts } = props;
  const q = query.trim().toLowerCase();
  const rows = urls.filter((u) => {
    if (filter === "Disabled" && u.enabled) return false;
    if ((filter === "OK" || filter === "FAILING" || filter === "UNKNOWN") && u.latestStatus !== filter) return false;
    return !q || u.name.toLowerCase().includes(q) || u.url.toLowerCase().includes(q);
  });
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(props.page, pageCount);
  const start = (page - 1) * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);
  const filterCount: Record<Filter, number> = {
    All: counts.total,
    OK: counts.ok,
    FAILING: counts.failing,
    UNKNOWN: counts.unknown,
    Disabled: urls.filter((u) => !u.enabled).length,
  };

  return (
    <>
      <PageHead
        title="Monitored URLs"
        subtitle="No screenshots are stored. Alerts are sent once per failure episode."
        canEdit={props.canEdit}
        onAdd={props.onAdd}
        onImport={props.onImport}
      />
      <section className="panel flush">
        <div className="toolbar">
          <input type="search" placeholder="Search name or URL" value={query} onChange={(e) => props.onQuery(e.target.value)} />
          <div className="seg">
            {FILTERS.map((f) => (
              <button key={f.key} className={filter === f.key ? "on" : ""} onClick={() => props.onFilter(f.key)}>
                {f.label}<span className="n">{filterCount[f.key]}</span>
              </button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <span className="muted small">{rows.length} of {urls.length}</span>
        </div>
        <div className="table-scroll">
          <div className="table">
            <div className="tr th url-grid">
              <span>Name / URL</span><span>Status</span><span>Category</span><span>HTTP</span><span>Duration</span><span>Last checked</span><span>Enabled</span><span />
            </div>
            {pageRows.map((u) => (
              <div key={u.id} className={`tr row url-grid ${u.enabled ? "" : "off"}`} onClick={() => props.onOpen(u.id)}>
                <div className="cell-name">
                  <span className="n">{u.name}</span>
                  <span className="u">{u.url}</span>
                </div>
                <span className={`pill ${u.latestStatus.toLowerCase()}`}>{u.latestStatus}</span>
                <span className="mono small" style={{ color: u.latestFailureCategory ? "var(--bad)" : "var(--muted)" }}>
                  {u.latestFailureCategory ?? "—"}
                </span>
                <span className="mono">{u.latestHttpStatus ?? "—"}</span>
                <span className="mono">{formatDuration(u.latestDurationMs)}</span>
                <span className="muted">{formatDate(u.latestCheckedAt)}</span>
                {props.canEdit ? (
                  <Form method="post" onClick={(e) => e.stopPropagation()}>
                    <input type="hidden" name="intent" value="toggle" />
                    <input type="hidden" name="id" value={u.id} />
                    <input type="hidden" name="enabled" value={String(u.enabled)} />
                    <button className={`toggle ${u.enabled ? "on" : ""}`} type="submit" title={u.enabled ? "Disable" : "Enable"} aria-label={u.enabled ? "Disable" : "Enable"}>
                      <span />
                    </button>
                  </Form>
                ) : (
                  <span className="muted small">{u.enabled ? "On" : "Off"}</span>
                )}
                {props.canEdit ? <DeleteForm id={u.id} compact /> : <span />}
              </div>
            ))}
            {rows.length === 0 ? (
              <div className="empty">{urls.length === 0 ? "Add or import URLs to start monitoring." : "No URLs match this filter."}</div>
            ) : null}
          </div>
        </div>
        {rows.length > PAGE_SIZE ? (
          <div className="pagination">
            <span className="muted small">
              {start + 1}–{Math.min(start + PAGE_SIZE, rows.length)} of {rows.length}
            </span>
            <div className="pager">
              <button className="btn xs" disabled={page <= 1} onClick={() => props.onPage(page - 1)}>← Prev</button>
              <span className="muted small">Page {page} of {pageCount}</span>
              <button className="btn xs" disabled={page >= pageCount} onClick={() => props.onPage(page + 1)}>Next →</button>
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}

function DeleteForm({ id, compact }: { id: number; compact?: boolean }) {
  return (
    <Form
      method="post"
      onClick={(e) => e.stopPropagation()}
      onSubmit={(event) => !confirm("Delete this monitored URL?") && event.preventDefault()}
      style={compact ? { justifySelf: "end" } : undefined}
    >
      <input type="hidden" name="intent" value="delete" />
      <input type="hidden" name="id" value={id} />
      <button className={compact ? "link-btn" : "btn danger"} type="submit">Delete</button>
    </Form>
  );
}

function Detail({ url, canEdit, cadenceMinutes, onBack }: { url: UrlRow; canEdit: boolean; cadenceMinutes: number; onBack: () => void }) {
  const signals = url.latestSignals ?? [];
  const facts = [
    { k: "HTTP status", v: url.latestHttpStatus ?? "—" },
    { k: "Duration", v: formatDuration(url.latestDurationMs) },
    { k: "Final URL", v: url.latestFinalUrl ?? "—" },
    {
      k: "AI review",
      v: url.latestAiClassification ? `${url.latestAiClassification}${url.latestAiConfidence != null ? ` · ${url.latestAiConfidence}%` : ""}` : "—",
    },
  ];

  return (
    <>
      <div className="page-head" style={{ alignItems: "flex-start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          <button className="btn xs" style={{ alignSelf: "flex-start" }} onClick={onBack}>← Back</button>
          <div className="detail-title">
            <h1 style={{ margin: 0 }}>{url.name}</h1>
            <span className={`pill ${url.latestStatus.toLowerCase()}`}>{url.latestStatus}</span>
            {!url.enabled ? <span className="pill">Disabled</span> : null}
          </div>
          <a className="mono small" href={url.url} target="_blank" rel="noreferrer">{url.url}</a>
        </div>
        {canEdit ? (
          <div className="actions">
            <Form method="post">
              <input type="hidden" name="intent" value="toggle" />
              <input type="hidden" name="id" value={url.id} />
              <input type="hidden" name="enabled" value={String(url.enabled)} />
              <button className="btn" type="submit">{url.enabled ? "Disable" : "Enable"}</button>
            </Form>
            <DeleteForm id={url.id} />
          </div>
        ) : null}
      </div>

      <div className="detail-grid">
        <div className="stack">
          <section className="panel flush">
            <div className="panel-head">
              <strong>Latest check result</strong>
              <span className="muted small">{formatDate(url.latestCheckedAt)}</span>
            </div>
            <div className="summary">
              <div>{url.latestSummary ?? "No check completed yet."}</div>
              {signals.length ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                  <span className="muted small">Suspicion signals</span>
                  <div className="signals">{signals.map((s) => <span key={s}>{s}</span>)}</div>
                </div>
              ) : null}
            </div>
            <div className="facts">
              {facts.map((f) => (
                <div key={f.k}><span>{f.k}</span><span>{f.v}</span></div>
              ))}
            </div>
          </section>

          {canEdit ? (
          <Form method="post" className="panel pad" key={url.id}>
            <input type="hidden" name="intent" value="update" />
            <input type="hidden" name="id" value={url.id} />
            <strong>Edit monitored URL</strong>
            <div className="form-grid">
              <label className="field">Name<input name="name" defaultValue={url.name} required /></label>
              <label className="field">URL<input className="mono" name="url" defaultValue={url.url} required /></label>
            </div>
            <label className="check-row"><input name="enabled" type="checkbox" defaultChecked={url.enabled} /> Enabled</label>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="btn primary" type="submit">Save</button>
            </div>
          </Form>
          ) : null}
        </div>

        <div className="stack">
          <section className="panel flush">
            <div className="panel-head"><strong>Failure episode</strong></div>
            <div className="kv"><span>Started</span><span>{url.failureStartedAt ? formatDate(url.failureStartedAt) : "—"}</span></div>
            <div className="kv"><span>Alert sent</span><span>{url.alertSentAt ? formatDate(url.alertSentAt) : "—"}</span></div>
            <div className="kv"><span>Recovered</span><span>{url.recoveredAt ? formatDate(url.recoveredAt) : "—"}</span></div>
          </section>
          <section className="panel flush">
            <div className="panel-head"><strong>Schedule</strong></div>
            <div className="kv"><span>Cadence</span><span>{cadenceMinutes} min</span></div>
            <div className="kv"><span>Next check</span><span>{url.enabled ? formatDate(url.nextCheckAt) : "—"}</span></div>
          </section>
          <p className="muted small" style={{ margin: 0, padding: "0 4px", lineHeight: 1.5 }}>
            Screenshots are ephemeral and discarded after each check.
          </p>
        </div>
      </div>
    </>
  );
}

function Metric({ label, value, sub, tone, onClick }: { label: string; value: string | number; sub?: string; tone?: "ok" | "bad"; onClick?: () => void }) {
  const inner = (
    <>
      <div className="k"><i />{label}</div>
      <strong>{value}</strong>
      {sub ? <div className="sub">{sub}</div> : null}
    </>
  );
  const className = `metric ${tone ? `tone-${tone}` : ""}`;
  return onClick ? <button className={className} onClick={onClick}>{inner}</button> : <div className={className}>{inner}</div>;
}

function formatDuration(ms: number | null) {
  return ms == null ? "—" : `${(ms / 1000).toFixed(1)}s`;
}

function formatTime(value: Date | string) {
  return new Intl.DateTimeFormat("en", { timeStyle: "short" }).format(new Date(value));
}

function formatDate(value: Date | string | null) {
  if (!value) return "Never checked";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
