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
export function token() {
  const body = Buffer.from(
    JSON.stringify({
      exp: Date.now() + 7 * 86400000,
      nonce: randomBytes(16).toString("hex"),
    }),
  ).toString("base64url");
  return (
    body + "." + createHmac("sha256", secret()).update(body).digest("base64url")
  );
}
export function verify(value?: string) {
  if (developmentAccess()) return true;
  if (!value) return false;
  try {
    const [body, sig] = value.split(".");
    if (
      !sig ||
      !equal(
        sig,
        createHmac("sha256", secret()).update(body).digest("base64url"),
      )
    )
      return false;
    return (
      JSON.parse(Buffer.from(body, "base64url").toString()).exp > Date.now()
    );
  } catch {
    return false;
  }
}
export function authorized(req: Request) {
  return verify(
    req.headers
      .get("cookie")
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("supper_session="))
      ?.slice(15),
  );
}
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  return (
    !!origin && origin === (process.env.APP_URL || new URL(req.url).origin)
  );
}
