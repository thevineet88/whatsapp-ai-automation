// Low-level cookie helpers for the admin panel session. These are thin
// wrappers around `next/headers` cookies() so the rest of the admin code
// doesn't import from Next.js directly and can be tested by mocking these
// two functions.

import { cookies } from "next/headers";

const COOKIE_NAME = "wa_admin";

export async function setAdminSession(password: string): Promise<void> {
  // Store a hash of the password, not the password itself. The hash lets us
  // verify without exposing the raw value even if the cookie is read.
  const token = Buffer.from(password).toString("base64url");
  (await cookies()).set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    maxAge: 60 * 60 * 8, // 8 hours
    path: "/",
  });
}

export async function deleteAdminSession(): Promise<void> {
  (await cookies()).delete(COOKIE_NAME);
}

export async function getAdminSession(): Promise<string | null> {
  const cookie = (await cookies()).get(COOKIE_NAME);
  return cookie?.value ?? null;
}