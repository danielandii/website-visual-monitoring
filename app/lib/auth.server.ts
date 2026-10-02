import { createHmac, timingSafeEqual } from "node:crypto";
import { redirect } from "react-router";
import { getConfig } from "./config.server";
import { legacyHash, verifyPasswordHash } from "./password.server";
import {
  countUsers,
  findUserById,
  findUserByUsername,
  insertUserWithHash,
  touchLastSignIn,
} from "~/db/users.server";
import type { User } from "~/db/schema";

const COOKIE_NAME = "wvm_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type SessionUser = Pick<User, "id" | "username" | "name" | "role">;

function sign(value: string) {
  return createHmac("sha256", getConfig().SESSION_SECRET).update(value).digest("hex");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** First run: seed an admin from ADMIN_USERNAME / ADMIN_PASSWORD(_HASH) so existing deployments keep working. */
async function ensureBootstrapAdmin() {
  if ((await countUsers()) > 0) return;
  const config = getConfig();
  const passwordHash = config.ADMIN_PASSWORD_HASH ?? (config.ADMIN_PASSWORD ? legacyHash(config.ADMIN_PASSWORD) : undefined);
  if (!passwordHash) return;
  await insertUserWithHash({ username: config.ADMIN_USERNAME.toLowerCase(), name: config.ADMIN_USERNAME, passwordHash, role: "ADMIN" });
}

export async function authenticate(username: string, password: string): Promise<User | null> {
  await ensureBootstrapAdmin();
  const user = await findUserByUsername(username.trim().toLowerCase());
  if (!user || !verifyPasswordHash(password, user.passwordHash)) return null;
  await touchLastSignIn(user.id);
  return user;
}

export function createSessionCookie(userId: number) {
  const payload = JSON.stringify({ sub: userId, exp: Date.now() + MAX_AGE_SECONDS * 1000 });
  const encoded = Buffer.from(payload).toString("base64url");
  const signature = sign(encoded);
  return `${COOKIE_NAME}=${encoded}.${signature}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;

  const [encoded, signature] = match[1].split(".");
  if (!encoded || !signature || !safeEqual(signature, sign(encoded))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { sub?: unknown; exp?: number };
    if (typeof payload.exp !== "number" || payload.exp <= Date.now() || typeof payload.sub !== "number") return null;
    const user = await findUserById(payload.sub);
    return user ? { id: user.id, username: user.username, name: user.name, role: user.role } : null;
  } catch {
    return null;
  }
}

export async function requireUser(request: Request) {
  const user = await getSessionUser(request);
  if (!user) throw redirect("/login", { headers: { "Set-Cookie": clearSessionCookie() } });
  return user;
}

export async function requireAdmin(request: Request) {
  const user = await requireUser(request);
  if (user.role !== "ADMIN") throw new Response("Admin access required.", { status: 403 });
  return user;
}
