import { useEffect, useRef } from "react";
import { Form, useActionData, useLoaderData } from "react-router";
import type { Route } from "./+types/users";
import { requireAdmin } from "~/lib/auth.server";
import { createUser, deleteUser, listUsers, resetUserPassword, setUserRole } from "~/db/users.server";
import { userRoleValues, type UserRole } from "~/db/schema";
import { Topbar } from "~/components/topbar";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Users · Website Visual Monitoring" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const me = await requireAdmin(request);
  return { users: await listUsers(), meId: me.id };
}

function parseRole(value: FormDataEntryValue | null): UserRole {
  const role = String(value ?? "");
  if (!(userRoleValues as readonly string[]).includes(role)) throw new Error("Invalid role.");
  return role as UserRole;
}

export async function action({ request }: Route.ActionArgs) {
  const me = await requireAdmin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    if (intent === "create") {
      await createUser({
        username: String(form.get("username") ?? ""),
        name: String(form.get("name") ?? ""),
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
        role: parseRole(form.get("role")),
      });
      return { ok: true, message: "User created." };
    }
    if (intent === "role") {
      await setUserRole(me.id, Number(form.get("id")), parseRole(form.get("role")));
      return { ok: true, message: "Role updated." };
    }
    if (intent === "password") {
      await resetUserPassword(Number(form.get("id")), String(form.get("password") ?? ""));
      return { ok: true, message: "Password reset." };
    }
    if (intent === "delete") {
      await deleteUser(me.id, Number(form.get("id")));
      return { ok: true, message: "User removed." };
    }
    return { ok: false, message: "Unknown action." };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Action failed." };
  }
}

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

export default function Users() {
  const { users, meId } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (actionData?.ok) dialogRef.current?.close();
  }, [actionData]);

  return (
    <>
      <Topbar crumbs={["Admin", "Users"]} />
      <div className="content">
        <div className="page-head">
          <div>
            <h1>Users</h1>
            <p>People who can sign in to the Monitoring Dashboard.</p>
          </div>
          <button className="btn primary" onClick={() => dialogRef.current?.showModal()}>Add user</button>
        </div>

        {actionData?.message ? <div className={actionData.ok ? "notice" : "notice error"} role="status">{actionData.message}</div> : null}

        <div className="grid-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          <div className="panel role-card">
            <strong>Admin</strong>
            <span className="muted">Add, edit, import and delete monitored URLs. Manage users and settings.</span>
          </div>
          <div className="panel role-card">
            <strong>Viewer</strong>
            <span className="muted">Read-only access to the overview, monitored URLs and latest check results.</span>
          </div>
        </div>

        <section className="panel flush">
          <div className="table-scroll">
            <div className="table" style={{ minWidth: 820 }}>
              <div className="tr th user-grid">
                <span>User</span><span>Role</span><span>Last sign-in</span><span>Password</span><span />
              </div>
              {users.map((u) => {
                const isMe = u.id === meId;
                const initials = u.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                return (
                  <div className="tr user-grid" key={u.id}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <div className="avatar">{initials}</div>
                      <div className="cell-name">
                        <span className="n">{u.name}{isMe ? <span className="muted" style={{ fontWeight: 400 }}> (you)</span> : null}</span>
                        <span className="u">{u.username}{u.email ? ` · ${u.email}` : ""}</span>
                      </div>
                    </div>
                    <Form method="post" className="seg" style={{ justifySelf: "start", opacity: isMe ? 0.6 : 1 }}>
                      <input type="hidden" name="intent" value="role" />
                      <input type="hidden" name="id" value={u.id} />
                      {userRoleValues.map((role) => (
                        <button key={role} type="submit" name="role" value={role} className={u.role === role ? "on" : ""} disabled={isMe || u.role === role}>
                          {role === "ADMIN" ? "Admin" : "Viewer"}
                        </button>
                      ))}
                    </Form>
                    <span className="muted">{u.lastSignInAt ? dateFormat.format(new Date(u.lastSignInAt)) : "Never"}</span>
                    <Form
                      method="post"
                      style={{ display: "flex", gap: 6 }}
                    >
                      <input type="hidden" name="intent" value="password" />
                      <input type="hidden" name="id" value={u.id} />
                      <input className="inline-input" name="password" type="password" placeholder="New password" minLength={12} required autoComplete="new-password" />
                      <button className="btn xs" type="submit">Reset</button>
                    </Form>
                    {!isMe ? (
                      <Form method="post" onSubmit={(e) => !confirm(`Remove ${u.name}?`) && e.preventDefault()} style={{ justifySelf: "end" }}>
                        <input type="hidden" name="intent" value="delete" />
                        <input type="hidden" name="id" value={u.id} />
                        <button className="link-btn" type="submit">Remove</button>
                      </Form>
                    ) : <span />}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>

      <dialog ref={dialogRef} className="modal" onClick={(e) => e.target === dialogRef.current && dialogRef.current?.close()}>
        <Form method="post">
          <input type="hidden" name="intent" value="create" />
          <div className="modal-head">
            <strong>Add user</strong>
            <span className="muted">Share the username and password with them directly; they can sign in right away.</span>
          </div>
          <div className="modal-body">
            <label className="field">Name<input name="name" placeholder="Rina Hartono" required /></label>
            <label className="field">Username<input className="mono" name="username" placeholder="rina" required autoComplete="off" /></label>
            <label className="field">Email (optional)<input name="email" type="email" placeholder="name@company.com" /></label>
            <label className="field">Password<input name="password" type="password" minLength={12} placeholder="At least 12 characters" required autoComplete="new-password" /></label>
            <fieldset className="role-pick">
              <legend>Role</legend>
              <label><input type="radio" name="role" value="VIEWER" defaultChecked /><span><strong>Viewer</strong><small>Read-only</small></span></label>
              <label><input type="radio" name="role" value="ADMIN" /><span><strong>Admin</strong><small>Full access</small></span></label>
            </fieldset>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn" onClick={() => dialogRef.current?.close()}>Cancel</button>
            <button type="submit" className="btn primary">Create user</button>
          </div>
        </Form>
      </dialog>
    </>
  );
}
