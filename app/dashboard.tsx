"use client";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChefHat,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CreditCard,
  ExternalLink,
  Leaf,
  LoaderCircle,
  Pause,
  RefreshCw,
  Settings2,
  ShoppingBasket,
  Sparkles,
  Truck,
  Utensils,
  Wallet,
  X,
} from "lucide-react";
import {
  CUISINES,
  DAYS,
  defaults,
  money,
  compatible,
  mealDate,
} from "@/lib/domain";
import type { State, Recipe, Preferences, Plan } from "@/lib/types";
type Data = State & {
  recipes: Recipe[];
  integrations: {
    stripe: boolean;
    ai: boolean;
    liveGroceries: boolean;
    livePrices: boolean;
    scheduler: boolean;
    lastJobAt?: string;
    localAccess: boolean;
  };
};
const prettyDate = (s: string) =>
  new Date(s + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
export default function Dashboard() {
  const [data, setData] = useState<Data>(),
    [tab, setTab] = useState("week"),
    [settings, setSettings] = useState(false),
    [detail, setDetail] = useState<Recipe>(),
    [swap, setSwap] = useState<number>(),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [preferences, setPreferences] = useState<Preferences>(defaults),
    [feedback, setFeedback] = useState(""),
    [pantryText, setPantryText] = useState("");
  const refresh = useCallback(async () => {
    const r = await fetch("/api/state", { cache: "no-store" });
    if (r.status === 401) {
      location.href = "/login";
      return;
    }
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    setData(j);
    setPreferences(j.preferences);
    setPantryText(
      j.preferences.pantry
        .map(
          (x: { name: string; quantity: number; unit: string }) =>
            `${x.name}, ${x.quantity}, ${x.unit}`,
        )
        .join("\n"),
    );
  }, []);
  const act = useCallback(
    async (path: string, body: unknown, label = path) => {
      setBusy(label);
      setError("");
      setNotice("");
      try {
        const r = await fetch("/api/" + path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        if (j.url) {
          location.href = j.url;
          return true;
        }
        await refresh();
        return true;
      } catch (e) {
        setError((e as Error).message);
        return false;
      } finally {
        setBusy("");
      }
    },
    [refresh],
  );
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    const q = new URLSearchParams(location.search);
    if (q.get("session_id")) {
      act(
        "stripe/reconcile",
        { sessionId: q.get("session_id") },
        "Confirming Stripe payment",
      ).then((ok) => {
        if (ok)
          setNotice(
            "Stripe test checkout checked. See the payment status below.",
          );
        history.replaceState({}, "", "/");
      });
    } else if (q.get("checkout") === "cancelled") {
      setNotice("Checkout cancelled. No payment was confirmed.");
      history.replaceState({}, "", "/");
    }
  }, [refresh, act]);
  useEffect(() => {
    if (!settings && detail === undefined && swap === undefined) return;
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const modal = document.querySelector<HTMLElement>("[role=dialog]");
    const controls = () =>
      Array.from(
        modal?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),a[href],input,select,textarea,[tabindex="0"]',
        ) ?? [],
      );
    controls()[0]?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const c = controls();
      if (e.shiftKey && document.activeElement === c[0]) {
        e.preventDefault();
        c.at(-1)?.focus();
      } else if (!e.shiftKey && document.activeElement === c.at(-1)) {
        e.preventDefault();
        c[0]?.focus();
      }
    };
    window.addEventListener("keydown", trap);
    const restore = () => {
      document.body.style.overflow = oldOverflow;
      window.removeEventListener("keydown", trap);
      previous?.focus();
    };
    const f = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSettings(false);
        setDetail(undefined);
        setSwap(undefined);
      }
    };
    window.addEventListener("keydown", f);
    return () => {
      window.removeEventListener("keydown", f);
      restore();
    };
  }, [settings, detail, swap]);
  const plan = data?.plans.find((p) => p.id === data.activePlanId),
    payments = data?.payments.filter((p) => p.planId === plan?.id) ?? [];
  const selected = plan?.preferences ?? preferences;
  const total = plan?.totalCents ?? 0;
  const spent =
    plan?.batches
      .filter((b) => ["submitted", "delivered"].includes(b.status))
      .reduce((s, b) => s + b.totalCents, 0) ?? 0;
  const ingredients = plan?.batches.flatMap((b) => b.groceries) ?? [];
  async function generate() {
    let pantry: Preferences["pantry"];
    try {
      pantry = pantryText.trim()
        ? pantryText
            .trim()
            .split("\n")
            .map((line) => {
              const [name, quantity, unit] = line
                .split(",")
                .map((x) => x.trim());
              if (
                !name ||
                !["g", "ml", "each"].includes(unit) ||
                !Number.isFinite(Number(quantity))
              )
                throw new Error(
                  "Use pantry format: ingredient, quantity, g/ml/each",
                );
              return { name, quantity: Number(quantity), unit };
            })
        : [];
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    if (
      await act(
        "plans/generate",
        { preferences: { ...preferences, pantry }, feedback },
        "Finding your dinners",
      )
    ) {
      setSettings(false);
      setTab("week");
      setNotice(
        "Your week is ready. Review it, then approve to enable sandbox ordering.",
      );
    }
  }
  function planAction(path: string) {
    if (plan) return act(path, { planId: plan.id, revision: plan.revision });
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-mark">
            <Utensils size={19} />
          </span>
          supper club<span className="brand-dot">.</span>
        </a>
        <div className="household">
          <span className="avatar">H</span>
          <div>
            Your household<small>A little less to think about.</small>
          </div>
        </div>
        <p className="nav-label">YOUR KITCHEN</p>
        <nav>
          {[
            { id: "week", label: "This week", Icon: CalendarDays },
            { id: "groceries", label: "Grocery list", Icon: ShoppingBasket },
            { id: "deliveries", label: "Deliveries", Icon: Truck },
            { id: "activity", label: "Activity", Icon: Clock3 },
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              <Icon size={19} />
              {label}
              {id === "week" && plan && (
                <span className="nav-count">{plan.meals.length}</span>
              )}
            </button>
          ))}
        </nav>
        <button className="preference-link" onClick={() => setSettings(true)}>
          <Settings2 size={18} />
          Preferences
        </button>
        <div className="sidebar-bottom">
          <div className="little-leaf">
            <Leaf size={22} />
          </div>
          <h3>Good food. Less fuss.</h3>
          <p>A week of dinners that makes room for the rest of your life.</p>
          <div className="sandbox-pill">
            <span /> SANDBOX KITCHEN
          </div>
          <small>No real grocery orders or charges.</small>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span>
            <span className="breadcrumb">Your kitchen</span>
            <ChevronRight size={14} />
            {tab === "week"
              ? "Weekly plan"
              : tab[0].toUpperCase() + tab.slice(1)}
          </span>
          <button
            className="text-button"
            onClick={() => {
              refresh().catch((e) => setError(e.message));
            }}
            aria-label="Refresh plan"
          >
            <RefreshCw size={15} />
            <span>Refresh</span>
          </button>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                <span className="tiny-line" /> DINNER, TAKEN CARE OF
              </p>
              <h1>
                {tab === "week"
                  ? "A good week starts at the table."
                  : tab === "groceries"
                    ? "Everything on your list."
                    : tab === "deliveries"
                      ? "A little planning. Right on time."
                      : "Your kitchen, in the loop."}
              </h1>
              <p className="subtitle">
                {tab === "week"
                  ? "Your tastes, your budget, a little help from us."
                  : tab === "groceries"
                    ? "Real recipe ingredients, grouped into practical delivery batches."
                    : tab === "deliveries"
                      ? "Ingredients arrive before you tie on your apron."
                      : "Every plan, approval, and sandbox order in one place."}
              </p>
            </div>
            <button className="secondary" onClick={() => setSettings(true)}>
              <Settings2 size={16} />
              Edit preferences
            </button>
          </div>
          {error && (
            <div className="alert error" role="alert">
              {error}
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              {notice}
              <button onClick={() => setNotice("")} aria-label="Dismiss notice">
                <X size={16} />
              </button>
            </div>
          )}
          {busy && (
            <div className="busy" role="status">
              <LoaderCircle className="spin" size={16} />
              {busy.includes("/") ? "Updating your kitchen…" : busy + "…"}
            </div>
          )}
          {!data && !error ? (
            <div className="loading">
              <LoaderCircle className="spin" />
              Setting the table…
            </div>
          ) : (
            <>
              <section className="overview">
                <div className="overview-title">
                  <span className="icon-circle">
                    <CalendarDays size={19} />
                  </span>
                  <div>
                    <small>YOUR DINNER PLAN</small>
                    <h3>
                      {plan
                        ? `${prettyDate(plan.week)} – ${prettyDate(mealDate(plan.week, 6))}`
                        : "Let’s plan your next week"}
                    </h3>
                  </div>
                </div>
                <div className="overview-item">
                  <span className="stat">{plan?.meals.length ?? 7}</span>
                  <span>
                    dinners
                    <br />
                    <small>{selected.servings} people at the table</small>
                  </span>
                </div>
                <div className="overview-item">
                  <span className="stat">{selected.cookingTime}</span>
                  <span>
                    aprons on
                    <br />
                    <small>
                      {selected.timezone.split("/").at(-1)?.replace("_", " ")}
                    </small>
                  </span>
                </div>
                <div className="overview-item">
                  <span className="stat">{money(selected.budgetCents)}</span>
                  <span>
                    weekly cap
                    <br />
                    <small>All costs included</small>
                  </span>
                </div>
              </section>
              {tab === "week" && (
                <>
                  <div className="section-title">
                    <div>
                      <h2>
                        {plan ? "On the menu" : "A taste of what’s possible"}
                        <span className={"status " + (plan?.status ?? "draft")}>
                          {plan
                            ? plan.status === "draft"
                              ? "Ready for review"
                              : plan.status
                            : "Let’s get started"}
                        </span>
                      </h2>
                      <p>
                        {plan
                          ? "Source-backed recipes, thoughtfully put together."
                          : "Published recipes. A plan built around you."}
                      </p>
                    </div>
                    {plan && (
                      <button
                        className="text-button"
                        onClick={() => setSettings(true)}
                      >
                        <RefreshCw size={14} />
                        Replan week
                      </button>
                    )}
                  </div>
                  <div className="planner-layout">
                    <div>
                      <div className="meal-grid">
                        {(
                          plan?.meals ??
                          data?.recipes
                            .filter((r) => compatible(r, defaults))
                            .slice(0, 6)
                            .map((recipe, day) => ({ recipe, day })) ??
                          []
                        ).map(({ day, recipe }, i) => (
                          <article
                            className={
                              "meal-card " + (i === 0 ? "featured" : "")
                            }
                            key={day}
                          >
                            <button
                              className="image-button"
                              onClick={() => setDetail(recipe)}
                              aria-label={"View " + recipe.title}
                            >
                              <img
                                src={recipe.image}
                                alt={recipe.title}
                                loading={i === 0 ? "eager" : "lazy"}
                              />
                              <span className="day-label">
                                {DAYS[day]}
                                {plan && (
                                  <small>
                                    {prettyDate(mealDate(plan.week, day))}
                                  </small>
                                )}
                              </span>
                              {i === 0 && (
                                <span className="pick">
                                  <Sparkles size={12} /> THIS WEEK’S PICK
                                </span>
                              )}
                            </button>
                            <div className="meal-body">
                              <div className="cuisine">
                                <span />
                                {recipe.cuisine} inspired
                              </div>
                              <button
                                className="meal-title"
                                onClick={() => setDetail(recipe)}
                              >
                                {recipe.title}
                              </button>
                              <div className="meal-meta">
                                <span>
                                  <Clock3 size={13} />
                                  {recipe.minutes} min
                                </span>
                                <span>
                                  <Utensils size={13} />
                                  {selected.servings} servings
                                </span>
                              </div>
                              <div className="meal-footer">
                                <a
                                  href={recipe.source}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {recipe.publisher}
                                  <ArrowUpRight size={13} />
                                </a>
                                {plan ? (
                                  <button
                                    onClick={() => setSwap(day)}
                                    disabled={!!busy}
                                    aria-label={"Swap " + DAYS[day] + " dinner"}
                                  >
                                    <RefreshCw size={13} />
                                    Swap
                                  </button>
                                ) : (
                                  <span>Published recipe</span>
                                )}
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                      <div className="source-note">
                        <Leaf size={17} />
                        <p>
                          Recipes come from real kitchens. View each original
                          recipe for full instructions.
                          <br />
                          <span>
                            Food photography belongs to the linked recipe
                            publisher.
                          </span>
                        </p>
                      </div>
                    </div>
                    <aside className="plan-aside">
                      <Budget
                        plan={plan}
                        budget={selected.budgetCents}
                        spent={spent}
                      />
                      <div className="approval-card">
                        <span className="icon-circle">
                          <ChefHat size={21} />
                        </span>
                        <h3>
                          {plan?.status === "approved"
                            ? "Your week is approved."
                            : "Make this week yours."}
                        </h3>
                        <p>
                          {plan?.status === "approved"
                            ? "We’ll handle the sandbox orders. You can pause any time before submission."
                            : "Swap anything that doesn’t sound like you. Nothing gets ordered until you approve."}
                        </p>
                        {!plan ? (
                          <button
                            className="primary"
                            onClick={() => setSettings(true)}
                          >
                            Plan my week
                            <ArrowRight size={16} />
                          </button>
                        ) : plan.status === "approved" ? (
                          <button
                            className="secondary full"
                            disabled={!!busy}
                            onClick={() => planAction("plans/pause")}
                          >
                            <Pause size={15} />
                            Pause ordering
                          </button>
                        ) : (
                          <button
                            className="primary"
                            disabled={!!busy || plan.status === "infeasible"}
                            onClick={() => planAction("plans/approve")}
                          >
                            <Check size={17} />
                            Approve this week
                          </button>
                        )}
                        <small>
                          {plan?.issue ?? "You’re always in control."}
                        </small>
                      </div>
                      <div className="delivery-note">
                        <Truck size={21} />
                        <div>
                          <h4>One less errand.</h4>
                          <p>
                            We group ingredients into{" "}
                            {plan?.batches.length ?? "a few"} deliveries,
                            scheduled before cooking starts.
                          </p>
                        </div>
                      </div>
                    </aside>
                  </div>
                </>
              )}
              {tab === "groceries" && (
                <>
                  <div className="section-title">
                    <div>
                      <h2>
                        Your shopping list
                        <span className="status draft">Sandbox prices</span>
                      </h2>
                      <p>
                        Whole packages are included in your budget. Pantry items
                        are subtracted first.
                      </p>
                    </div>
                    <button
                      className="secondary"
                      disabled={
                        !!busy || !plan || !data?.integrations.livePrices
                      }
                      onClick={() =>
                        plan &&
                        act(
                          "groceries/prices",
                          { planId: plan.id },
                          "Checking real store prices",
                        )
                      }
                    >
                      <RefreshCw size={14} />
                      Check live prices
                    </button>
                  </div>
                  {!plan ? (
                    <Empty onClick={() => setSettings(true)} />
                  ) : (
                    plan.batches.map((b, i) => (
                      <section className="panel" key={b.id}>
                        <div className="panel-heading">
                          <h3>
                            <ShoppingBasket size={18} />
                            Delivery {i + 1} ·{" "}
                            {b.days.map((d) => DAYS[d].slice(0, 3)).join(", ")}
                          </h3>
                          <b>{money(b.subtotalCents)}</b>
                        </div>
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>Ingredient</th>
                                <th>Recipe needs</th>
                                <th>Buy</th>
                                <th>Sandbox cost</th>
                              </tr>
                            </thead>
                            <tbody>
                              {b.groceries.map((g, j) => (
                                <tr key={j}>
                                  <td className="capitalize">
                                    {g.name}
                                    {g.pantryUsed > 0 && (
                                      <small>
                                        {g.pantryUsed.toFixed(1)} {g.unit} from
                                        pantry
                                      </small>
                                    )}
                                  </td>
                                  <td>
                                    {g.required.toFixed(1)} {g.unit}
                                  </td>
                                  <td>
                                    {g.packages} × {g.packageSize} {g.unit}
                                  </td>
                                  <td>{money(g.totalCents)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    ))
                  )}
                  <div className="alert neutral">
                    {data?.integrations.livePrices
                      ? "Kroger lookup is available. Product candidates are separate from the sandbox budget and do not authorize purchases."
                      : "Add Kroger API credentials to check real store prices. The grocery plan currently uses clearly labeled synthetic package prices."}
                  </div>
                  {plan?.livePrices && (
                    <section className="panel">
                      <div className="panel-heading">
                        <h3>
                          Live product prices · {plan.livePrices.storeName}
                        </h3>
                        <small>
                          {new Date(plan.livePrices.fetchedAt).toLocaleString()}
                        </small>
                      </div>
                      <p className="muted">
                        Search candidates only. Verify product suitability and
                        package sizes. Delivery, tax, tips, availability, and a
                        bounded final checkout total are not included.
                      </p>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Ingredient</th>
                              <th>Product candidate</th>
                              <th>Package</th>
                              <th>Regular price</th>
                            </tr>
                          </thead>
                          <tbody>
                            {plan.livePrices.items.map((x) => (
                              <tr key={x.ingredient}>
                                <td>{x.ingredient}</td>
                                <td>{x.description ?? x.error}</td>
                                <td>{x.size ?? "—"}</td>
                                <td>
                                  {x.regularCents === undefined
                                    ? "Unavailable"
                                    : money(x.regularCents)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}
                </>
              )}
              {tab === "deliveries" && (
                <>
                  <div className="section-title">
                    <div>
                      <h2>
                        Delivery schedule
                        <span className="status draft">Simulation only</span>
                      </h2>
                      <p>
                        Order ahead. Have ingredients ready an hour before
                        cooking.
                      </p>
                    </div>
                    {plan && (
                      <button
                        className="secondary"
                        disabled={!!busy || plan.status !== "approved"}
                        onClick={() => planAction("sandbox/run")}
                      >
                        <Truck size={16} />
                        Simulate orders now
                      </button>
                    )}
                  </div>
                  {!plan ? (
                    <Empty onClick={() => setSettings(true)} />
                  ) : (
                    <div className="delivery-grid">
                      {plan.batches.map((b, i) => (
                        <section className="panel delivery-card" key={b.id}>
                          <div className="panel-heading">
                            <span className="icon-circle">
                              <Truck size={21} />
                            </span>
                            <span className={"status " + b.status}>
                              {b.status}
                            </span>
                          </div>
                          <h3>Delivery {i + 1}</h3>
                          <p>{b.days.map((d) => DAYS[d]).join(" · ")}</p>
                          <div className="schedule-row">
                            <span>Arrives by</span>
                            <b>
                              {new Date(b.deliveryAt).toLocaleString("en-US", {
                                timeZone: selected.timezone,
                                weekday: "short",
                                hour: "numeric",
                                minute: "2-digit",
                              })}
                            </b>
                          </div>
                          <div className="schedule-row">
                            <span>Order scheduled</span>
                            <b>
                              {new Date(b.orderAt).toLocaleString("en-US", {
                                timeZone: selected.timezone,
                                month: "short",
                                day: "numeric",
                                hour: "numeric",
                                minute: "2-digit",
                              })}
                            </b>
                          </div>
                          <div className="schedule-row">
                            <span>All-in sandbox total</span>
                            <b>{money(b.totalCents)}</b>
                          </div>
                          {b.reason && <p className="error">{b.reason}</p>}
                          {b.orderId && (
                            <small className="order-id">{b.orderId}</small>
                          )}
                          {!["cancelled", "delivered"].includes(b.status) && (
                            <button
                              className="text-button"
                              disabled={!!busy}
                              onClick={() =>
                                act("sandbox/cancel", {
                                  planId: plan.id,
                                  batchId: b.id,
                                })
                              }
                            >
                              Cancel sandbox order
                            </button>
                          )}
                        </section>
                      ))}
                    </div>
                  )}
                  <section className="panel payment-panel">
                    <div>
                      <span className="eyebrow">STRIPE TEST MODE</span>
                      <h2>A checkout without the charge.</h2>
                      <p>
                        Test the approved {money(total)} weekly total in Stripe
                        Checkout.
                        <br />
                        No money moves. This does not purchase groceries.
                      </p>
                      <div className="test-card">
                        <CreditCard size={18} />
                        <code>4242 4242 4242 4242</code>
                        <small>Any future date · Any CVC</small>
                      </div>
                    </div>
                    <div className="payment-action">
                      <button
                        className="primary"
                        disabled={
                          !!busy ||
                          !plan ||
                          plan.status !== "approved" ||
                          !data?.integrations.stripe ||
                          payments.some((p) => p.status === "paid")
                        }
                        onClick={() =>
                          plan &&
                          act(
                            "stripe/checkout",
                            { planId: plan.id },
                            "Opening Stripe test checkout",
                          )
                        }
                      >
                        <CreditCard size={16} />
                        {payments.some((p) => p.status === "paid")
                          ? "Test payment confirmed"
                          : "Try Stripe checkout"}
                        <ArrowUpRight size={15} />
                      </button>
                      <small>
                        {!data?.integrations.stripe
                          ? "Add STRIPE_SECRET_KEY (sk_test_) to enable."
                          : plan?.status !== "approved"
                            ? "Approve a weekly plan first."
                            : "Secure checkout hosted by Stripe."}
                      </small>
                      {payments.map((p) => (
                        <div className="payment-status" key={p.id}>
                          <span className={"status " + p.status}>
                            {p.status}
                          </span>
                          {money(p.amountCents)}
                          {p.sessionId && (
                            <button
                              className="text-button"
                              disabled={!!busy}
                              onClick={() =>
                                act("stripe/reconcile", {
                                  sessionId: p.sessionId,
                                })
                              }
                            >
                              <RefreshCw size={12} />
                              Check payment
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                  <p className="muted">
                    {data?.integrations.lastJobAt
                      ? "Last scheduled runner: " +
                        new Date(data.integrations.lastJobAt).toLocaleString()
                      : "Scheduled runner has not checked in yet. Set up the cron endpoint to run while the app is closed."}
                  </p>
                </>
              )}
              {tab === "activity" && (
                <>
                  <section className="panel">
                    <div className="panel-heading">
                      <h3>Kitchen journal</h3>
                      <span className="status draft">
                        Saved to your database
                      </span>
                    </div>
                    {!data?.events.length ? (
                      <p className="muted">
                        Your first plan is the start of the story.
                      </p>
                    ) : (
                      data.events.map((e) => (
                        <div className="activity-row" key={e.id}>
                          <span className="activity-dot" />
                          <div>
                            {e.message}
                            <small>{new Date(e.at).toLocaleString()}</small>
                          </div>
                        </div>
                      ))
                    )}
                  </section>
                  <section className="panel">
                    <h3>Connections</h3>
                    {[
                      [
                        "Recipe discovery",
                        data?.integrations.ai
                          ? "OpenAI browsing connected"
                          : "Published recipe library · no API key needed",
                      ],
                      [
                        "Grocery ordering",
                        "Sandbox only · live provider access required",
                      ],
                      [
                        "Stripe",
                        data?.integrations.stripe
                          ? "Test key configured"
                          : "Test key not configured",
                      ],
                      [
                        "Automation",
                        data?.integrations.lastJobAt
                          ? "Runner verified by check-in"
                          : "Awaiting first runner check-in",
                      ],
                    ].map(([name, value]) => (
                      <div className="schedule-row" key={name}>
                        <span>{name}</span>
                        <b>{value}</b>
                      </div>
                    ))}
                  </section>
                  {data && data.plans.length > 1 && (
                    <section className="panel">
                      <h3>Saved weeks</h3>
                      {data.plans.map((p) => (
                        <button
                          key={p.id}
                          className="secondary"
                          onClick={() => act("plans/select", { planId: p.id })}
                        >
                          {prettyDate(p.week)} · {p.status}
                        </button>
                      ))}
                    </section>
                  )}
                </>
              )}
            </>
          )}
          <footer className="footer">
            <span className="brand-small">supper club.</span>
            <span>More time at the table. Less time figuring it out.</span>
            <span>PRIVATE PROTOTYPE</span>
          </footer>
        </div>
      </main>
      {settings && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSettings(false);
          }}
        >
          <section
            className="modal preferences-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="preferences-title"
          >
            <button
              className="close"
              onClick={() => setSettings(false)}
              aria-label="Close preferences"
            >
              <X size={20} />
            </button>
            <span className="eyebrow">LET’S SET YOUR TABLE</span>
            <h2 id="preferences-title">What sounds good this week?</h2>
            <p>A few preferences. A whole week off your mind.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                generate();
              }}
            >
              <label>Cuisines you’re craving</label>
              <div className="chips">
                {CUISINES.map((c) => (
                  <button
                    type="button"
                    key={c}
                    aria-pressed={preferences.cuisines.includes(c)}
                    className={
                      preferences.cuisines.includes(c) ? "selected" : ""
                    }
                    onClick={() =>
                      setPreferences({
                        ...preferences,
                        cuisines: preferences.cuisines.includes(c)
                          ? preferences.cuisines.filter((x) => x !== c)
                          : [...preferences.cuisines, c],
                      })
                    }
                  >
                    {preferences.cuisines.includes(c) && <Check size={13} />}{" "}
                    {c}
                  </button>
                ))}
              </div>
              <div className="form-grid">
                <label>
                  People at the table
                  <input
                    type="number"
                    min="1"
                    max="12"
                    value={preferences.servings}
                    onChange={(e) =>
                      setPreferences({
                        ...preferences,
                        servings: Number(e.target.value),
                      })
                    }
                    required
                  />
                </label>
                <label>
                  Weekly budget · all in ($)
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    step="0.01"
                    value={preferences.budgetCents / 100}
                    onChange={(e) =>
                      setPreferences({
                        ...preferences,
                        budgetCents: Math.round(Number(e.target.value) * 100),
                      })
                    }
                    required
                  />
                </label>
                <label>
                  Start cooking at
                  <input
                    type="time"
                    value={preferences.cookingTime}
                    onChange={(e) =>
                      setPreferences({
                        ...preferences,
                        cookingTime: e.target.value,
                      })
                    }
                    required
                  />
                </label>
                <label>
                  Timezone
                  <select
                    value={preferences.timezone}
                    onChange={(e) =>
                      setPreferences({
                        ...preferences,
                        timezone: e.target.value,
                      })
                    }
                  >
                    {[
                      "America/Los_Angeles",
                      "America/Denver",
                      "America/Phoenix",
                      "America/Chicago",
                      "America/New_York",
                      "America/Anchorage",
                      "Pacific/Honolulu",
                    ].map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </label>
                <label>
                  ZIP code
                  <input
                    inputMode="numeric"
                    pattern="[0-9]{5}"
                    value={preferences.zip}
                    onChange={(e) =>
                      setPreferences({ ...preferences, zip: e.target.value })
                    }
                    required
                  />
                </label>
                <label>
                  Diet
                  <select
                    value={preferences.diet}
                    onChange={(e) =>
                      setPreferences({
                        ...preferences,
                        diet: e.target.value as Preferences["diet"],
                      })
                    }
                  >
                    <option value="none">No dietary preference</option>
                    <option value="vegetarian">Vegetarian</option>
                    <option value="vegan">Vegan</option>
                  </select>
                </label>
              </div>
              <label>Dinner days</label>
              <div className="chips days">
                {DAYS.map((d, i) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={preferences.days.includes(i)}
                    className={preferences.days.includes(i) ? "selected" : ""}
                    onClick={() =>
                      setPreferences({
                        ...preferences,
                        days: preferences.days.includes(i)
                          ? preferences.days.filter((x) => x !== i)
                          : [...preferences.days, i].sort(),
                      })
                    }
                  >
                    {d.slice(0, 3)}
                  </button>
                ))}
              </div>
              <details>
                <summary>A few more preferences</summary>
                <div className="form-grid">
                  <label>
                    Avoid ingredients (comma-separated)
                    <input
                      value={preferences.exclusions.join(", ")}
                      onChange={(e) =>
                        setPreferences({
                          ...preferences,
                          exclusions: e.target.value
                            .split(",")
                            .map((x) => x.trim())
                            .filter(Boolean),
                        })
                      }
                      placeholder="mushrooms, peanuts"
                    />
                  </label>
                  <label>
                    Tip per delivery ($)
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={preferences.tipCents / 100}
                      onChange={(e) =>
                        setPreferences({
                          ...preferences,
                          tipCents: Math.round(Number(e.target.value) * 100),
                        })
                      }
                    />
                  </label>
                </div>
                <small>
                  Ingredient exclusions are text filters, not verified allergen
                  certification. Live grocery purchasing is disabled.
                </small>
                <label>
                  Delivery address (optional in sandbox)
                  <input
                    value={preferences.address}
                    onChange={(e) =>
                      setPreferences({
                        ...preferences,
                        address: e.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Pantry stock
                  <textarea
                    value={pantryText}
                    onChange={(e) => setPantryText(e.target.value)}
                    placeholder={"rice, 500, g\nolive oil, 250, ml"}
                  />
                  <small>
                    One ingredient per line: name, quantity, g/ml/each
                  </small>
                </label>
                <label>
                  Anything else for the recipe agent?
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="More one-pot meals, please."
                  />
                  <small>
                    {data?.integrations.ai
                      ? "OpenAI will browse for recipes matching this feedback."
                      : "Requires an OpenAI API key. Cuisine selection and swaps work without one."}
                  </small>
                </label>
              </details>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={preferences.recurring}
                  onChange={(e) =>
                    setPreferences({
                      ...preferences,
                      recurring: e.target.checked,
                    })
                  }
                />
                Draft next week every Friday. I’ll approve before ordering.
              </label>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <button
                className="primary full"
                disabled={
                  !!busy ||
                  !preferences.cuisines.length ||
                  !preferences.days.length
                }
                type="submit"
              >
                {busy ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <Sparkles size={17} />
                )}{" "}
                {busy ? "Finding your dinners…" : "Build my dinner plan"}
                <ArrowRight size={17} />
              </button>
              <p className="form-footnote">
                Real recipes · Sandbox grocery prices · No purchases
              </p>
            </form>
          </section>
        </div>
      )}
      {detail && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDetail(undefined);
          }}
        >
          <section
            className="modal recipe-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="recipe-title"
          >
            <button
              className="close"
              onClick={() => setDetail(undefined)}
              aria-label="Close recipe"
            >
              <X size={20} />
            </button>
            <img
              className="recipe-cover"
              src={detail.image}
              alt={detail.title}
            />
            <div className="recipe-content">
              <p className="eyebrow">
                {detail.cuisine.toUpperCase()} INSPIRED · {detail.minutes}{" "}
                MINUTES
              </p>
              <h2 id="recipe-title">{detail.title}</h2>
              <p>
                Original recipe serves {detail.servings}. Your shopping list
                scales to {selected.servings}.
              </p>
              <h3>From the recipe</h3>
              <ul className="ingredients">
                {detail.ingredients.map((x, i) => (
                  <li key={i}>
                    <Check size={13} />
                    {x}
                  </li>
                ))}
              </ul>
              <a
                className="primary"
                href={detail.source}
                target="_blank"
                rel="noreferrer"
              >
                Cook with the original recipe
                <ExternalLink size={16} />
              </a>
              <small>
                Source: {detail.publisher} · Retrieved{" "}
                {new Date(detail.fetchedAt).toLocaleDateString()}
              </small>
            </div>
          </section>
        </div>
      )}
      {swap !== undefined && plan && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="swap-title"
          >
            <button
              className="close"
              onClick={() => setSwap(undefined)}
              aria-label="Close swaps"
            >
              <X size={20} />
            </button>
            <p className="eyebrow">A CHANGE OF PLANS</p>
            <h2 id="swap-title">Something else for {DAYS[swap]}?</h2>
            <p>A swap creates a new draft for you to approve.</p>
            <div className="swap-list">
              {data?.recipes
                .filter(
                  (r) =>
                    plan.preferences.cuisines.includes(r.cuisine) &&
                    compatible(r, plan.preferences) &&
                    r.id !== plan.meals.find((m) => m.day === swap)?.recipe.id,
                )
                .map((r) => (
                  <button
                    key={r.id}
                    disabled={!!busy}
                    onClick={async () => {
                      if (
                        await act("plans/swap", {
                          planId: plan.id,
                          revision: plan.revision,
                          day: swap,
                          recipeId: r.id,
                        })
                      )
                        setSwap(undefined);
                    }}
                  >
                    <img src={r.image} alt="" />
                    <span>
                      <b>{r.title}</b>
                      <small>
                        {r.cuisine} · {r.minutes} min
                      </small>
                    </span>
                    <ArrowRight size={17} />
                  </button>
                ))}
            </div>
            {error && <p className="error">{error}</p>}
          </section>
        </div>
      )}
    </div>
  );
}
function Empty({ onClick }: { onClick: () => void }) {
  return (
    <div className="empty">
      <ChefHat size={36} />
      <h3>Your table is waiting.</h3>
      <p>Build a dinner plan to see your groceries and deliveries here.</p>
      <button className="primary" onClick={onClick}>
        Plan my week
        <ArrowRight size={16} />
      </button>
    </div>
  );
}
function Budget({
  plan,
  budget,
  spent,
}: {
  plan?: Plan;
  budget: number;
  spent: number;
}) {
  const sum = (key: "subtotalCents" | "feeCents" | "taxCents" | "tipCents") =>
    plan?.batches.reduce((a, b) => a + b[key], 0) ?? 0;
  const total = plan?.totalCents ?? 0;
  return (
    <div className="budget-card">
      <div className="budget-heading">
        <Wallet size={18} />
        <h3>Your weekly budget</h3>
        <span className="sandbox-label">SANDBOX</span>
      </div>
      <div className="budget-number">
        {money(total)}
        <span> / {money(budget)}</span>
      </div>
      <div className="budget-track">
        <span
          className={total > budget ? "over" : ""}
          style={{ width: Math.min((total / budget) * 100, 100) + "%" }}
        />
      </div>
      <p className={total > budget ? "error" : "budget-room"}>
        {total > budget
          ? money(total - budget) + " over budget"
          : money(budget - total) + " breathing room"}
      </p>
      <div className="budget-breakdown">
        {[
          ["Groceries", sum("subtotalCents")],
          ["Delivery & service", sum("feeCents")],
          ["Tax (simulated)", sum("taxCents")],
          ["Tips", sum("tipCents")],
        ].map(([label, n]) => (
          <div key={label}>
            <span>{label}</span>
            <span>{money(Number(n))}</span>
          </div>
        ))}
      </div>
      <div className="budget-total">
        <span>Weekly total</span>
        <b>{money(total)}</b>
      </div>
      <small className="budget-commit">
        {money(spent)} in submitted sandbox orders
      </small>
      <div className="budget-guarantee">
        <CheckCircle2 size={15} />
        <span>Your cap is enforced before every order.</span>
      </div>
    </div>
  );
}
