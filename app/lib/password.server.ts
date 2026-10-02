import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

/** Accepts `scrypt$salt$hash` and the legacy unsalted SHA-256 hex used by ADMIN_PASSWORD_HASH. */
export function verifyPasswordHash(password: string, stored: string) {
  if (stored.startsWith("scrypt$")) {
    const [, salt, hash] = stored.split("$");
    if (!salt || !hash) return false;
    return safeEqual(scryptSync(password, salt, 64).toString("hex"), hash);
  }
  return safeEqual(createHash("sha256").update(password).digest("hex"), stored);
}

export function legacyHash(password: string) {
  return createHash("sha256").update(password).digest("hex");
}
