import { NextRequest, NextResponse } from "next/server";
import { authOrigin, finishGoogleSignIn } from "@/lib/google-auth";
import { readState } from "@/lib/db";
import { token } from "@/lib/auth";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(req: NextRequest) {
  let response: NextResponse;
  try {
    const query=req.nextUrl.searchParams;
    const code=query.get("code");
    if (!code || query.has("error")) throw new Error("Sign-in cancelled");
    const result=await finishGoogleSignIn(code,req.cookies.get("supper_google_flow")?.value,query.get("state"));
    response=NextResponse.redirect(new URL((await readState()).onboardedProfiles?.includes(result.profile.id) ? result.next : "/onboarding",authOrigin()));
    response.cookies.set("supper_session",token(result.profile),{httpOnly:true,secure:authOrigin().startsWith("https:"),sameSite:"lax",path:"/",maxAge:604800});
  } catch { response=NextResponse.redirect(authOrigin()+"/login?error=google_failed"); }
  response.cookies.set("supper_google_flow","",{httpOnly:true,secure:authOrigin().startsWith("https:"),sameSite:"lax",path:"/api/auth/google",maxAge:0});
  response.headers.set("Cache-Control","no-store");
  return response;
}
