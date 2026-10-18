import { googleConfigured, safeReturnTo } from "@/lib/google-auth";
import LoginForm from "./login-form";
export const dynamic = "force-dynamic";
export default async function Login({searchParams}: {searchParams: Promise<{error?: string; next?: string}>}) {
  const {error,next}=await searchParams;
  const authError=error==="google_failed"?"Google sign-in didn’t finish. Try again with your invited account.":error==="google_unavailable"?"Google sign-in is unavailable right now.":undefined;
  return <LoginForm googleEnabled={googleConfigured()} authError={authError} returnTo={safeReturnTo(next)} />;
}
