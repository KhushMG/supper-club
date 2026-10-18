import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verify } from "@/lib/auth";
import Dashboard from "./dashboard";
export const dynamic = "force-dynamic";
export default async function Home() {
  if (!verify((await cookies()).get("supper_session")?.value))
    redirect("/login");
  return <Dashboard />;
}
