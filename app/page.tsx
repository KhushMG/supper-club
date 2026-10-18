import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sessionProfile, verify } from "@/lib/auth";
import { readState } from "@/lib/db";
import Dashboard from "./dashboard";
export const dynamic = "force-dynamic";
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; checkout?: string }>;
}) {
  const query = await searchParams;
  if (typeof query.session_id === "string")
    redirect(
      "/checkout/success?session_id=" + encodeURIComponent(query.session_id),
    );
  if (!verify((await cookies()).get("supper_session")?.value))
    redirect("/login");
  const profile = sessionProfile((await cookies()).get("supper_session")?.value);
  if (profile && !(await readState()).onboardedProfiles?.includes(profile.id)) redirect("/onboarding");
  return <Dashboard />;
}
