import { Form, redirect, useActionData } from "react-router";
import type { Route } from "./+types/login";
import { authenticate, createSessionCookie, getSessionUser } from "~/lib/auth.server";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Login · Website Visual Monitoring" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  if (await getSessionUser(request)) throw redirect("/");
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");

  const user = await authenticate(username, password);
  if (!user) {
    return { error: "Invalid username or password." };
  }

  throw redirect("/", {
    headers: { "Set-Cookie": createSessionCookie(user.id) },
  });
}

export default function Login() {
  const actionData = useActionData<typeof action>();

  return (
    <main className="login-shell">
      <div className="login-wrap">
        <div className="brand">
          <img className="brand-mark" src="/logo.png" alt="" />
          <strong>Website Visual Monitoring</strong>
        </div>
        <Form method="post" className="login-card">
          <div>
            <h1>Sign in</h1>
            <p className="muted" style={{ margin: 0 }}>
              Manage public URLs, check current status, and keep Discord alerts under control.
            </p>
          </div>
          <label className="field">
            Username
            <input name="username" autoComplete="username" required />
          </label>
          <label className="field">
            Password
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          {actionData?.error ? <p className="form-error">{actionData.error}</p> : null}
          <button type="submit" className="btn primary">Sign in</button>
        </Form>
        <p className="muted small" style={{ textAlign: "center", margin: 0 }}>Private monitor</p>
      </div>
    </main>
  );
}
