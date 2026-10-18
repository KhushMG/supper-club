import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verify } from "@/lib/auth";
import { reconcile } from "@/lib/stripe";
import type { Payment } from "@/lib/types";
import Link from "next/link";
import { CheckCircle2, Utensils } from "lucide-react";
export const dynamic = "force-dynamic";
export default async function Receipt({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const query = await searchParams;
  const sessionId =
    typeof query.session_id === "string" ? query.session_id : "";
  const receiptUrl =
    "/checkout/success?session_id=" + encodeURIComponent(sessionId);
  if (!verify((await cookies()).get("supper_session")?.value))
    redirect("/login?next=" + encodeURIComponent(receiptUrl));
  let payment: Payment | undefined;
  try {
    payment = await reconcile(sessionId);
  } catch {
    /* Never claim success without verification. */
  }
  const paid = payment?.status === "paid";
  const expired = payment?.status === "expired";
  return (
    <main className="login-page">
      <div className="login-card">
        <div className="brand">
          <span className="brand-mark">
            <Utensils size={20} />
          </span>
          supper club<span className="brand-dot">.</span>
        </div>
        <p className="eyebrow">STRIPE TEST CHECKOUT</p>
        {paid && <CheckCircle2 size={48} color="#315c45" aria-hidden="true" />}
        <h1>
          {paid
            ? "Payment successful."
            : expired
              ? "Checkout expired."
              : "Payment not confirmed."}
        </h1>
        <p>
          {paid
            ? "Your test payment is confirmed. Your weekly dinner plan is ready to view."
            : expired
              ? "This checkout timed out. Return to your plan to start a new checkout."
              : "We could not confirm a completed payment. Check again before starting another checkout."}
        </p>
        {paid && payment && (
          <p>
            <strong>
              {new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: "USD",
              }).format(payment.amountCents / 100)}{" "}
              USD
            </strong>
            <br />
            <small>Reference: {payment.id}</small>
          </p>
        )}
        <p>
          No real money moved. This test payment does not purchase groceries.
        </p>
        <Link className="primary" href="/">
          Back to my dinner plan
        </Link>
        {!paid && !expired && (
          <p>
            <a href={receiptUrl}>Check payment status again</a>
          </p>
        )}
      </div>
    </main>
  );
}
