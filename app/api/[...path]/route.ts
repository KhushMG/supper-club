import { prepareSimulation } from "@/lib/simulation";
import { pricePlan } from "@/lib/kroger-basket";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readState, mutate } from "@/lib/db";
import {
  authorized,
  developmentAccess,
  equal,
  sameOrigin,
  token,
} from "@/lib/auth";
import {
  preferenceSchema,
  nextMonday,
  makePlan,
  approve,
  pause,
  quote,
  processDue,
  log,
  compatible,
} from "@/lib/domain";
import { recipes, discover } from "@/lib/recipes";
import {
  createCheckout,
  reconcile,
  testStripe,
  acceptPayment,
} from "@/lib/stripe";
import { krogerEnvironment } from "@/lib/grocery-prices";
import { runJobs } from "@/lib/jobs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
const id = z.string().uuid();
async function handle(req: Request) {
  try {
    const path = new URL(req.url).pathname.replace("/api/", "");
    if (path === "stripe/webhook" && req.method === "POST") {
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!secret) return json({ error: "Webhook is not configured." }, 503);
      const signature = req.headers.get("stripe-signature");
      if (!signature) return json({ error: "Missing signature" }, 400);
      let event;
      try {
        event = testStripe().webhooks.constructEvent(
          await req.text(),
          signature,
          secret,
        );
      } catch {
        return json({ error: "Invalid Stripe signature" }, 400);
      }
      if (event.livemode) return json({ error: "Live events rejected" }, 400);
      if (
        event.type === "checkout.session.completed" ||
        event.type === "checkout.session.async_payment_succeeded"
      ) {
        await mutate((s) => acceptPayment(s, event.data.object));
      }
      return json({ received: true });
    }
    if (path === "jobs" && req.method === "GET") {
      if (
        !process.env.CRON_SECRET ||
        !equal(
          req.headers.get("authorization") ?? "",
          "Bearer " + process.env.CRON_SECRET,
        )
      )
        return json({ error: "Unauthorized" }, 401);
      return json(await runJobs());
    }
    if (req.method === "POST" && !sameOrigin(req))
      return json({ error: "Invalid request origin" }, 403);
    if (path === "login" && req.method === "POST") {
      const { password } = z
        .object({ password: z.string().max(300) })
        .parse(await req.json());
      if (!process.env.APP_PASSWORD || process.env.APP_PASSWORD.length < 16)
        return json(
          {
            error:
              "Set APP_PASSWORD (16+ characters) and AUTH_SECRET (32+ characters) on the server.",
          },
          503,
        );
      if (!equal(password, process.env.APP_PASSWORD)) {
        await new Promise((r) => setTimeout(r, 1000));
        return json({ error: "Incorrect household password" }, 401);
      }
      const response = json({ ok: true });
      response.cookies.set("supper_session", token(), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 7 * 86400,
      });
      return response;
    }
    if (!authorized(req)) return json({ error: "Please sign in." }, 401);
    if (req.method === "GET" && path === "state") {
      const s = await readState();
      return json({
        ...s,
        recipes,
        integrations: {
          stripe:
            process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_") ?? false,
          ai: !!process.env.OPENAI_API_KEY,
          liveGroceries: false,
          krogerEnvironment: krogerEnvironment(),
          livePrices:
            !!process.env.KROGER_CLIENT_ID &&
            !!process.env.KROGER_CLIENT_SECRET,
          scheduler: !!process.env.CRON_SECRET,
          lastJobAt: s.lastJobAt,
          localAccess: developmentAccess(),
        },
      });
    }
    if (req.method !== "POST") return json({ error: "Not found" }, 404);
    const body = await req.json();
    if (path === "logout") {
      const r = json({ ok: true });
      r.cookies.delete("supper_session");
      return r;
    }
    if (path === "preferences") {
      const preferences = preferenceSchema.parse(body);
      await mutate((s) => {
        s.preferences = preferences;
        log(
          s,
          "Preferences saved. Existing approved plans keep their original settings.",
        );
      });
      return json({ ok: true });
    }
    if (path === "plans/generate") {
      const { preferences, feedback } = z
        .object({
          preferences: preferenceSchema,
          feedback: z.string().max(1000).default(""),
        })
        .parse(body);
      const state = await readState();
      const week = nextMonday(new Date(), preferences.timezone);
      const existing = state.plans.find((p) => p.week === week);
      if (
        existing &&
        state.payments.some(
          (p) => p.planId === existing.id && p.status !== "expired",
        )
      )
        throw new Error(
          "Finish or expire the Stripe checkout before replacing this week.",
        );
      if (existing?.batches.some((b) => b.orderId))
        throw new Error(
          "This week already has orders. You can pause outstanding orders but cannot replace the purchased plan.",
        );
      const found = await discover(preferences, feedback);
      const plan = makePlan(
        found.recipes,
        preferences,
        week,
        feedback,
        found.mode,
        true,
      );
      await pricePlan(plan);
      await mutate((s) => {
        const current = s.plans.find((p) => p.week === week);
        if (
          current?.batches.some((b) => b.orderId) ||
          s.payments.some(
            (p) => p.planId === current?.id && p.status !== "expired",
          )
        )
          throw new Error(
            "Plan changed while generating. Refresh before trying again.",
          );
        s.preferences = preferences;
        s.plans = s.plans.filter((p) => p.week !== week);
        s.plans.unshift(plan);
        s.activePlanId = plan.id;
        log(
          s,
          "A new weekly draft is ready. All grocery prices are sandbox estimates.",
        );
      });
      return json({ plan });
    }
    if (path === "plans/select") {
      const planId = id.parse(body.planId);
      await mutate((s) => {
        if (!s.plans.some((p) => p.id === planId))
          throw new Error("Unknown plan");
        s.activePlanId = planId;
      });
      return json({ ok: true });
    }
    if (path === "plans/swap") {
      const args = z
        .object({
          planId: id,
          revision: z.number().int(),
          day: z.number().int().min(0).max(6),
          recipeId: z.string().max(200),
        })
        .parse(body);
      const revised = await mutate((s) => {
        const p = s.plans.find((p) => p.id === args.planId);
        if (!p || p.revision !== args.revision)
          throw new Error("Plan changed. Refresh first.");
        if (
          p.batches.some((b) => b.orderId) ||
          s.payments.some((x) => x.planId === p.id && x.status !== "expired")
        )
          throw new Error(
            "This plan has an order or checkout. Resolve it before changing meals.",
          );
        const recipe = [...recipes, ...p.meals.map((m) => m.recipe)].find(
          (r) => r.id === args.recipeId,
        );
        if (
          !recipe ||
          !p.preferences.cuisines.includes(recipe.cuisine) ||
          !compatible(recipe, p.preferences)
        )
          throw new Error("Recipe does not match your preferences.");
        const meal = p.meals.find((m) => m.day === args.day);
        if (!meal) throw new Error("Dinner day not found.");
        meal.recipe = recipe;
        p.revision++;
        quote(p);
        p.pricingSource = "kroger";
        delete p.simulationQuote;
        log(s, "Meal swapped. Kroger prices are being refreshed.");
        return structuredClone(p);
      });
      await pricePlan(revised);
      await mutate((s) => {
        const index = s.plans.findIndex(
          (p) => p.id === revised.id && p.revision === revised.revision,
        );
        if (index < 0)
          throw new Error("Plan changed while pricing. Refresh prices again.");
        s.plans[index] = revised;
      });
      return json({ ok: true });
    }
    if (
      path === "plans/approve" ||
      path === "plans/pause" ||
      path === "sandbox/run"
    ) {
      const args = z
        .object({ planId: id, revision: z.number().int() })
        .parse(body);
      await mutate((s) => {
        const p = s.plans.find((p) => p.id === args.planId);
        if (!p || p.revision !== args.revision)
          throw new Error("Plan changed. Refresh first.");
        if (path === "plans/approve") {
          approve(p);
          log(
            s,
            "Weekly plan approved. Only sandbox grocery orders are enabled.",
          );
        } else if (path === "plans/pause") {
          pause(p);
          log(
            s,
            "Unsubmitted orders paused. Submitted sandbox orders remain visible.",
          );
        } else {
          if (p.status !== "approved")
            throw new Error("Approve the plan first.");
          const n = processDue(p, new Date(), true);
          log(
            s,
            `Simulated ${n} grocery order(s). No real groceries purchased.`,
          );
        }
      });
      return json({ ok: true });
    }
    if (path === "sandbox/cancel") {
      const { planId, batchId } = z
        .object({ planId: id, batchId: z.string() })
        .parse(body);
      await mutate((s) => {
        const p = s.plans.find((p) => p.id === planId),
          b = p?.batches.find((b) => b.id === batchId);
        if (!b || b.status === "delivered")
          throw new Error("Order cannot be cancelled.");
        b.status = "cancelled";
        log(s, "Sandbox cancellation confirmed.");
      });
      return json({ ok: true });
    }
    if (path === "sandbox/quote") {
      const args = z.object({ planId: id, revision: z.number().int(), budgetCents: z.number().int().min(100).max(200000).optional() }).parse(body);
      await mutate(s => {
        const p = s.plans.find(p => p.id === args.planId);
        if (!p || p.revision !== args.revision) throw new Error("Plan changed. Refresh first.");
        if (s.payments.some(payment => payment.planId === p.id && ["open", "creating"].includes(payment.status)))
          throw new Error("Resolve the open test checkout first.");
        if (args.budgetCents !== undefined) p.preferences.budgetCents = args.budgetCents;
        prepareSimulation(p);
        log(s, "Prepared simulation quote: mock $5 per unpriced ingredient, $5.99 per delivery, 8% mock tax, no tip. No real purchase.");
      });
      return json({ok: true});
    }
    if (path === "groceries/prices") {
      const planId = id.parse(body.planId);
      const state = await readState();
      const plan = state.plans.find((p) => p.id === planId);
      if (!plan) throw new Error("Plan not found.");
      if (
        state.payments.some(
          (p) => p.planId === planId && ["open", "creating"].includes(p.status),
        )
      )
        throw new Error(
          "Resolve the open Stripe checkout before repricing this plan.",
        );
      if (plan.batches.some((b) => b.orderId))
        throw new Error(
          "Ordered plans retain their original pricing. Create a new week for Kroger pricing.",
        );
      const revision = plan.revision;
      await pricePlan(plan);
      await mutate((s) => {
        const index = s.plans.findIndex(
          (p) => p.id === planId && p.revision === revision,
        );
        if (
          index < 0 ||
          s.plans[index].batches.some((b) => b.orderId) ||
          s.payments.some(
            (p) =>
              p.planId === planId && ["open", "creating"].includes(p.status),
          )
        )
          throw new Error(
            "Plan changed while pricing. Refresh before trying again.",
          );
        plan.revision++;
        s.plans[index] = plan;
        log(
          s,
          "Shopping list rebuilt using Kroger products and package prices. Purchases remain held until the final all-in quote is available.",
        );
      });
      return json({ ok: true });
    }
    if (path === "stripe/checkout") {
      const planId = id.parse(body.planId);
      const origin = process.env.APP_URL || new URL(req.url).origin;
      return json(await createCheckout(planId, origin));
    }
    if (path === "stripe/reconcile") {
      const sessionId = z.string().max(300).parse(body.sessionId);
      return json(await reconcile(sessionId));
    }
    return json({ error: "Not found" }, 404);
  } catch (e) {
    if (e instanceof z.ZodError)
      return json({ error: e.issues.map((x) => x.message).join(". ") }, 400);
    return json(
      { error: e instanceof Error ? e.message : "Request failed" },
      400,
    );
  }
}
export const GET = handle;
export const POST = handle;
