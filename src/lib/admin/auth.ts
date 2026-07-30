// Admin panel auth: single shared password stored in the tenant config
// row alongside the escalation contacts and holding reply. One admin, no
// per-user accounts. Cookie stores the password hash so a server-side
// password rotation immediately invalidates every existing cookie.

import { timingSafeEqual } from "node:crypto";
import { getAdminSession } from "./cookies";

function readStoredPassword(config: unknown): string | null {
  if (!config || typeof config !== "object") return null;
  const value = (config as { adminPassword?: unknown }).adminPassword;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function isAdminAuthenticated(config: unknown): Promise<boolean> {
  const storedPassword = readStoredPassword(config);
  if (!storedPassword) return false;

  const session = await getAdminSession();
  if (!session) return false;

  // Decode the cookie back to the original password. Buffer.from with
  // 'base64url' matches the encoding used in cookies.ts.
  let cookiePassword: string;
  try {
    cookiePassword = Buffer.from(session, "base64url").toString("utf8");
  } catch {
    return false;
  }

  if (cookiePassword.length !== storedPassword.length) return false;
  return timingSafeEqual(Buffer.from(cookiePassword), Buffer.from(storedPassword));
}

export function checkAdminPassword(config: unknown, candidate: string): boolean {
  const storedPassword = readStoredPassword(config);
  if (!storedPassword) return false;
  if (candidate.length !== storedPassword.length) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(storedPassword));
}