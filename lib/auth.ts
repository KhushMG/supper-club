import type { Profile } from "./auth-profile";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
export function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function developmentAccess() {
  return (
    process.env.NODE_ENV === "development" &&
    !process.env.APP_PASSWORD &&
    !process.env.VERCEL
  );
}
function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32)
    throw new Error("Set AUTH_SECRET to at least 32 random characters.");
  return s;
}
export function signAuthData(data: Record<string, unknown>) {
  const body = Buffer.from(JSON.stringify(data)).toString("base64url");
  return body + "." + createHmac("sha256", secret()).update(body).digest("base64url");
}
export function readAuthData(value?: string): Record<string, unknown> | undefined {
  if (!value) return;
  try {
    const parts = value.split(".");
    if (parts.length !== 2 || !equal(parts[1], createHmac("sha256", secret()).update(parts[0]).digest("base64url"))) return;
    const data = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    if (!Number.isFinite(data.exp) || data.exp <= Date.now()) return;
    return data;
  } catch { return; }
}
export function token(profile?: Profile) {
  return signAuthData({ purpose: "session", exp: Date.now() + 7 * 86400000,
    nonce: randomBytes(16).toString("hex"), ...(profile ? { profile } : {}) });
}
export function googleAllowedEmails() {
  return [process.env.GOOGLE_ALLOWED_EMAILS, process.env.GOOGLE_ADDITIONAL_ALLOWED_EMAILS]
    .filter(Boolean).join(",").split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
}
export function allowedGoogleEmail(email: string) {
  return googleAllowedEmails().includes(email.toLowerCase());
}
export function sessionProfile(value?: string): Profile | undefined {
  const data = readAuthData(value);
  if (data?.purpose !== "session") return;
  const p = data.profile as Profile | undefined;
  if (p?.provider !== "google" || typeof p.id !== "string" || typeof p.name !== "string" || typeof p.email !== "string" || !allowedGoogleEmail(p.email)) return;
  return p;
}
export function verify(value?: string) {
  if (developmentAccess()) return true;
  const data = readAuthData(value);
  if (!data || (data.purpose !== undefined && data.purpose !== "session")) return false;
  return data.profile ? !!sessionProfile(value) : true;
}
export function requestSession(req: Request) {
  return req.headers.get("cookie")?.split(";").map(x=>x.trim()).find(x=>x.startsWith("supper_session="))?.slice(15);
}
export function authorized(req: Request) {
  return verify(requestSession(req));
}
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  return (
    !!origin && origin === (process.env.APP_URL || new URL(req.url).origin)
  );
}
