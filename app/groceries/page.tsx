import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verify } from "@/lib/auth";
import Home from "../page";
export const dynamic = "force-dynamic";
export default async function Page() {
  if (!verify((await cookies()).get("supper_session")?.value)) redirect("/login?next=/groceries");
  return <Home searchParams={Promise.resolve({})}/>;
}
