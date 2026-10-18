import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey, type JWTPayload } from "jose";
import { allowedGoogleEmail, equal, readAuthData, signAuthData } from "./auth";
import type { Profile } from "./auth-profile";
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
export function googleConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_ALLOWED_EMAILS?.trim());
}
export function authOrigin() {
  const url = new URL(process.env.APP_URL || "http://localhost:3000");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("Invalid auth origin");
  return url.origin;
}
export function safeReturnTo(value?: string | null) {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  const u = new URL(value, "https://local.example");
  return ["/", "/profile", "/checkout/success"].includes(u.pathname) ? u.pathname + u.search : "/";
}
export function beginGoogleSignIn(next?: string | null) {
  if (!googleConfigured()) throw new Error("Google sign-in is not configured");
  const state = randomBytes(32).toString("base64url"), nonce = randomBytes(32).toString("base64url"), verifier = randomBytes(32).toString("base64url");
  const cookie = signAuthData({purpose:"google-oauth",state,nonce,verifier,next:safeReturnTo(next),exp:Date.now()+600000});
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID!,redirect_uri:authOrigin()+"/api/auth/google/callback",response_type:"code",scope:"openid email profile",state,nonce,code_challenge:createHash("sha256").update(verifier).digest("base64url"),code_challenge_method:"S256",prompt:"select_account"}).toString();
  return {url:url.href,cookie};
}
export function readGoogleFlow(cookie: string | undefined, state: string | null) {
  const flow=readAuthData(cookie);
  if (!flow || flow.purpose!=="google-oauth" || !state || typeof flow.state!=="string" || !equal(flow.state,state) || typeof flow.nonce!=="string" || typeof flow.verifier!=="string") throw new Error("Invalid sign-in state");
  return {nonce:flow.nonce,verifier:flow.verifier,next:safeReturnTo(typeof flow.next==="string"?flow.next:undefined)};
}
export function googleProfile(payload: JWTPayload, nonce: string): Profile {
  if (payload.nonce!==nonce || payload.email_verified!==true || typeof payload.email!=="string" || !payload.sub || !allowedGoogleEmail(payload.email)) throw new Error("Google account is not allowed");
  if (payload.azp && payload.azp!==process.env.GOOGLE_CLIENT_ID) throw new Error("Invalid authorized party");
  return {id:"google:"+payload.sub,name:typeof payload.name==="string"?payload.name.slice(0,120):payload.email.split("@")[0],email:payload.email.toLowerCase(),provider:"google"};
}
export async function verifyGoogleToken(idToken: string, nonce: string, keys: JWTVerifyGetKey = googleKeys) {
  const {payload}=await jwtVerify(idToken,keys,{issuer:["https://accounts.google.com","accounts.google.com"],audience:process.env.GOOGLE_CLIENT_ID,algorithms:["RS256"],requiredClaims:["sub","exp","iat","email","email_verified","nonce"]});
  return googleProfile(payload,nonce);
}
export async function finishGoogleSignIn(code: string, cookie: string | undefined, state: string | null) {
  if (!googleConfigured()) throw new Error("Google sign-in is not configured");
  const flow=readGoogleFlow(cookie,state);
  const response=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID!,client_secret:process.env.GOOGLE_CLIENT_SECRET!,code,code_verifier:flow.verifier,grant_type:"authorization_code",redirect_uri:authOrigin()+"/api/auth/google/callback"}),signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error("Google sign-in exchange failed");
  const result=await response.json();
  if (typeof result.id_token!=="string") throw new Error("Missing Google identity");
  return {profile:await verifyGoogleToken(result.id_token,flow.nonce),next:flow.next};
}
