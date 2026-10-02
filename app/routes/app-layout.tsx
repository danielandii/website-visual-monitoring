import { Form, NavLink, Outlet, useLoaderData, useLocation } from "react-router";
import type { Route } from "./+types/app-layout";
import { requireUser } from "~/lib/auth.server";
import { countMonitoredUrls } from "~/db/monitored-urls.server";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  return { user, urlCount: await countMonitoredUrls() };
}

export default function AppLayout() {
  const { user, urlCount } = useLoaderData<typeof loader>();
  const location = useLocation();
  const onUrls = location.pathname === "/" && new URLSearchParams(location.search).has("view");
  const isAdmin = user.role === "ADMIN";
  const initials = user.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="side-brand">
          <img className="brand-mark sm" src="/logo.png" alt="" />
          <div>
            <strong>Visual Monitoring</strong>
            <span>Production</span>
          </div>
        </div>
        <nav className="side-nav">
          <div className="nav-label">Monitor</div>
          <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive && !onUrls ? "active" : ""}`}>
            <span className="dot" />
            <span className="label">Overview</span>
          </NavLink>
          <NavLink to="/?view=urls" className={() => `nav-item ${onUrls ? "active" : ""}`}>
            <span className="dot" />
            <span className="label">Monitored URLs</span>
            <span className="count">{urlCount}</span>
          </NavLink>
          {isAdmin ? (
            <>
              <div className="nav-label" style={{ paddingTop: 14 }}>Admin</div>
              <NavLink to="/users" className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
                <span className="dot" />
                <span className="label">Users</span>
              </NavLink>
              <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
                <span className="dot" />
                <span className="label">Settings</span>
              </NavLink>
            </>
          ) : null}
        </nav>
        <div className="side-user">
          <div className="avatar">{initials}</div>
          <div className="who">
            <span style={{ fontWeight: 500 }}>{user.name}</span>
            <span>{isAdmin ? "Admin" : "Viewer"}</span>
          </div>
          <Form method="post" action="/logout">
            <button className="btn xs" type="submit">Sign out</button>
          </Form>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
