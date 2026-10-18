import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verify } from "@/lib/auth";
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
  return <Dashboard />;
}
