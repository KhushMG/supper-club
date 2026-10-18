import { NextResponse } from "next/server";
import { authOrigin, beginGoogleSignIn } from "@/lib/google-auth";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(req: Request) {
  try {
    const flow=beginGoogleSignIn(new URL(req.url).searchParams.get("next"));
    const response=NextResponse.redirect(flow.url);
    response.headers.set("Cache-Control","no-store");
    response.cookies.set("supper_google_flow",flow.cookie,{httpOnly:true,secure:authOrigin().startsWith("https:"),sameSite:"lax",path:"/api/auth/google",maxAge:600});
    return response;
  } catch { return NextResponse.redirect(authOrigin()+"/login?error=google_unavailable"); }
}
