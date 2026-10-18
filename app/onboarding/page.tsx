import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionProfile } from "@/lib/auth";
import { readState } from "@/lib/db";
import Survey from "./survey";
export const dynamic = "force-dynamic";
export default async function Onboarding() {
  const profile = sessionProfile((await cookies()).get("supper_session")?.value);
  if (!profile) redirect("/login");
  if ((await readState()).onboardedProfiles?.includes(profile.id)) redirect("/");
  return <Survey name={profile.name}/>;
}
