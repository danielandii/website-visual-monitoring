import { asc, eq, sql } from "drizzle-orm";
import { getDb, withDbRetry } from "./client.server";
import { users, type User, type UserRole } from "./schema";
import { hashPassword, verifyPasswordHash } from "~/lib/password.server";

export type PublicUser = Omit<User, "passwordHash">;

function toPublic({ passwordHash: _passwordHash, ...rest }: User): PublicUser {
  return rest;
}

export async function listUsers(): Promise<PublicUser[]> {
  const rows = await withDbRetry(() => getDb().select().from(users).orderBy(asc(users.createdAt), asc(users.id)), { label: "list users" });
  return rows.map(toPublic);
}

export async function countUsers() {
  const [row] = await getDb().select({ count: sql<number>`count(*)` }).from(users);
  return Number(row?.count ?? 0);
}

export async function findUserById(id: number) {
  const [row] = await withDbRetry(() => getDb().select().from(users).where(eq(users.id, id)).limit(1), { label: "find user" });
  return row ?? null;
}

export async function findUserByUsername(username: string) {
  const [row] = await withDbRetry(() => getDb().select().from(users).where(eq(users.username, username)).limit(1), { label: "find user by username" });
  return row ?? null;
}

export async function insertUserWithHash(input: { username: string; name: string; email?: string | null; passwordHash: string; role: UserRole }) {
  await getDb().insert(users).values({
    username: input.username,
    name: input.name,
    email: input.email ?? null,
    passwordHash: input.passwordHash,
    role: input.role,
  });
}

export async function createUser(input: { username: string; name: string; email?: string; password: string; role: UserRole }) {
  const username = input.username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,64}$/.test(username)) throw new Error("Username must be 3-64 characters: letters, numbers, dot, dash or underscore.");
  if (input.password.length < 12) throw new Error("Password must be at least 12 characters.");
  if (await findUserByUsername(username)) throw new Error("That username is already taken.");

  await insertUserWithHash({
    username,
    name: input.name.trim() || username,
    email: input.email?.trim() || null,
    passwordHash: hashPassword(input.password),
    role: input.role,
  });
}

async function adminCount() {
  const [row] = await getDb().select({ count: sql<number>`count(*)` }).from(users).where(eq(users.role, "ADMIN"));
  return Number(row?.count ?? 0);
}

export async function setUserRole(actorId: number, id: number, role: UserRole) {
  if (actorId === id) throw new Error("You cannot change your own role.");
  const target = await findUserById(id);
  if (!target) throw new Error("User not found.");
  if (target.role === "ADMIN" && role !== "ADMIN" && (await adminCount()) <= 1) throw new Error("At least one admin is required.");
  await getDb().update(users).set({ role }).where(eq(users.id, id));
}

export async function deleteUser(actorId: number, id: number) {
  if (actorId === id) throw new Error("You cannot remove your own account.");
  const target = await findUserById(id);
  if (!target) throw new Error("User not found.");
  if (target.role === "ADMIN" && (await adminCount()) <= 1) throw new Error("At least one admin is required.");
  await getDb().delete(users).where(eq(users.id, id));
}

export async function resetUserPassword(id: number, password: string) {
  if (password.length < 12) throw new Error("Password must be at least 12 characters.");
  await getDb().update(users).set({ passwordHash: hashPassword(password) }).where(eq(users.id, id));
}

export async function changeOwnPassword(id: number, current: string, next: string) {
  const user = await findUserById(id);
  if (!user || !verifyPasswordHash(current, user.passwordHash)) throw new Error("Current password is incorrect.");
  await resetUserPassword(id, next);
}

export async function updateProfile(id: number, input: { name: string; email?: string }) {
  const name = input.name.trim();
  if (!name) throw new Error("Name is required.");
  await getDb().update(users).set({ name, email: input.email?.trim() || null }).where(eq(users.id, id));
}

export async function touchLastSignIn(id: number) {
  await getDb().update(users).set({ lastSignInAt: new Date() }).where(eq(users.id, id));
}
