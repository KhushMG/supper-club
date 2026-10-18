import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { UserRound } from "lucide-react";
import { sessionProfile, verify } from "@/lib/auth";
import { initials } from "@/lib/auth-profile";
import { googleConfigured } from "@/lib/google-auth";
import { SignOut } from "./sign-out";
export const dynamic="force-dynamic";
export default async function ProfilePage() {
  const session=(await cookies()).get("supper_session")?.value;
  if (!verify(session)) redirect("/login?next=/profile");
  const profile=sessionProfile(session);
  return <main className="profile-page">
    <a className="text-button" href="/">← Back to your dinners</a>
    <section className="profile-card">
      <div className="profile-heading"><span className="avatar profile-avatar">{profile?initials(profile.name):<UserRound size={28}/>}</span>
        <div><p className="eyebrow">YOUR ACCOUNT</p><h1>Your profile</h1></div>
      </div>
      <dl className="profile-fields">
        <div><dt>Name</dt><dd>{profile?.name || "Not linked"}</dd></div>
        <div><dt>Email</dt><dd>{profile?.email || "Not linked"}</dd></div>
        <div><dt>Sign-in method</dt><dd>{profile?"Google":"Household access"}</dd></div>
        {profile&&<div><dt>Account ID</dt><dd className="account-id">{profile.id}</dd></div>}
      </dl>
      <p className="muted">{profile?"Your name and email come from your Google account.":"Sign in with Google to link your name and email."}</p>
      <div className="profile-actions">
        {!profile&&googleConfigured()&&<a className="google-signin" href="/api/auth/google?next=/profile">Continue with Google</a>}
        <SignOut/>
      </div>
    </section>
  </main>;
}
