# Supper Club

Cuisine preferences → actual published recipes → ingredient quantities → Kroger product matching and package prices → final-quote hold. Includes **Stripe test Checkout**, persistent household state, meal swaps, pantry quantities, delivery scheduling, and an activity log. 

## Current deployment

- App: https://supper-club-umber.vercel.app
- Private source: https://github.com/KhushMG/supper-club
- Hosting: Vercel, with a free Turso database and Stripe test sandbox.
- The generated household sign-in password is saved in `.local-access.txt` on the development machine (ignored by Git).
- `.github/workflows/scheduler.yml` invokes the protected runner hourly using repository secrets.

## Run locally

Node 22+ and npm:

```sh
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000. A local SQLite database is created automatically. With no password configured, **development only** skips sign-in. Production always requires a household password and signed session.

Build a plan, then open **Grocery list**. Plan generation, meal swaps, and scheduled drafts query Kroger automatically. The shopping list shows matched products, retailer package prices, required package counts when units are compatible, and unresolved items. There is no synthetic-price fallback. Defaults are a $200 weekly all-in cap, two servings, and seven dinners.

## Stripe test transaction

1. In your Stripe dashboard’s test mode/sandbox, copy the **secret** test key into `STRIPE_SECRET_KEY` in `.env.local`. It must start with `sk_test_`; live keys are rejected. Do not put it in a `NEXT_PUBLIC_` variable.
2. Restart the development server.
3. Stripe Checkout remains available for legacy approved sandbox plans. New Kroger-priced plans are held because product prices do not include a final delivery/tax/fee quote. Existing paid receipts remain available.
4. At Stripe’s hosted checkout, use `4242 4242 4242 4242`, any future expiry, and any three-digit CVC. Use `4000 0000 0000 0002` for a decline scenario.
5. On return, the server retrieves the Checkout Session from Stripe and verifies the saved attempt ID, plan/revision, amount, USD currency, and `livemode=false` before recording payment. A success query parameter alone never marks it paid.

Optional webhook testing:

```sh
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Copy the displayed `whsec_…` signing secret into `STRIPE_WEBHOOK_SECRET`, then restart. Subscribe deployed endpoints to `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Webhooks validate signatures on the raw request body. A duplicate callback does not duplicate the payment record. Browser return reconciliation works even without a webhook.

A test payment charges the approved **sandbox weekly total**, but moves no real money and does **not** purchase groceries. Sessions are persisted before network calls and use a stable Stripe idempotency key. Cancelled browser checkout remains open until Stripe expires it (one hour); check its status before starting another. Plans with outstanding checkout or completed test payments cannot be silently replaced.

## Deploy to Vercel

This is ordinary Next.js: no Cloudflare/Sites runtime or custom build adapter is required.

1. Push this directory to a GitHub repository and import it into Vercel. Keep the detected Next.js defaults (`npm run build`). Alternatively run `npx vercel` from this directory.
2. Create a **libSQL-compatible Turso database**. Set `TURSO_DATABASE_URL=libsql://…` and `TURSO_AUTH_TOKEN` in Vercel’s environment settings. The schema initializes automatically on first request. Local `file:` databases are explicitly rejected on Vercel so data cannot disappear between invocations.
3. Set `APP_URL` to the deployed HTTPS origin. Set `APP_PASSWORD` to a long household password (16+ characters) and `AUTH_SECRET` to a different random string (32+ characters). Generate secrets with `openssl rand -hex 32`.
4. Add `STRIPE_SECRET_KEY=sk_test_…`. Add `STRIPE_WEBHOOK_SECRET` if using the deployed Stripe webhook endpoint. Redeploy after environment changes.
5. Sign in with the household password. Run a test checkout and verify its status.

Only the household knows the password. This prototype is single-household, not a public multi-tenant service. Use Vercel deployment protection as an additional access boundary if desired. Stripe webhooks must remain reachable if deployment protection is enabled; otherwise use authenticated return reconciliation.

### Scheduled processing while closed

Set `CRON_SECRET` to a random secret, then arrange an hourly authenticated request: `GET /api/jobs`:

```sh
curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/jobs"
```

This repository includes an hourly GitHub Actions scheduler. Set repository Actions secrets `APP_URL` and `CRON_SECRET` to activate it; they are configured for the current deployment. Use **Actions → Run dinner planner → Run workflow** for an immediate run. GitHub scheduled runs can be delayed, so delivery slots must still be checked at execution.

Alternatively, if your Vercel plan supports hourly cron, replace `vercel.json` with `vercel.cron.example.json` and redeploy. The default config deliberately does not require a paid cron tier. Any external scheduler that securely supplies the Authorization header also works. A configured secret alone does not mean scheduling is active; **Activity/Deliveries shows the last successful runner check-in**.

The runner never starts weekly planning; the user must first select Find my dinners. It resumes explicitly authorized in-progress agent runs. Legacy sandbox approved batches submit 24 hours before the target delivery time; Kroger-priced plans cannot submit without a final quote; arrival targets are one hour before cooking. Batches cover at most three days. Missed delivery windows are held for review. Repeated jobs do not create duplicate sandbox orders.

### Other deployment options

`npm run build && npm start` runs on any Node 22+ host. A Dockerfile is included. Use a libSQL-compatible Turso database for shared persistence or a mounted local SQLite volume on a single-server deployment. Run `/api/jobs` from your scheduler with its bearer secret.

## Recipe sources and optional AI

The checked-in recipe snapshots were extracted from actual Budget Bytes Recipe JSON-LD. Every card links to its source and shows retrieval time in its detail view. Recipe photos belong to the linked publisher. Full cooking instructions stay on the original site.

Without an AI key, generation refreshes matching published recipes directly, falling back to their dated snapshots if the source is temporarily unavailable. Ingredient lists without explicit quantities are rejected rather than guessed; this can mean a particular cuisine/diet has no eligible recipe. `npm run recipes:refresh` updates snapshots.

Set `OPENAI_API_KEY` for the bounded tool-calling agent described below. It searches the public web and fetches source Recipe JSON-LD, with cached results and free-text preferences. Recipe content cannot authorize purchases. AI API usage is separate from the grocery budget. No Edamam account is used. Uncached web searches incur a capped OpenAI search charge.

## Real store price lookup

Create a Kroger developer application with Products API access and set `KROGER_CLIENT_ID` and `KROGER_CLIENT_SECRET` on the server. Generation, swaps, and scheduled drafts populate the shopping list through `lib/kroger-basket.ts` and `lib/grocery-prices.ts`. **Refresh Kroger prices** reprices an existing unsubmitted plan and invalidates purchase approval. Open Stripe attempts and submitted orders block repricing.

Ingredient quantities are scaled to servings, grouped by delivery, and reduced by pantry stock. Container weights are preserved. Product retrieval normalizes ingredient names, retries known synonyms, checks up to two 50-product pages, and verifies missing prices through product-detail calls at the same store. Matching rejects household tools, prepared-food substitutions, and unwanted blends. Transient 429/5xx responses retry once; the lookup has a 45-second overall deadline. Package counts round up using Kroger's actual package size and regular price, including explicit multipacks and total-weight stick packs. When dimensions do not match or package sizes are unknown, one whole package per week is assumed and labeled. Measurable leftovers carry forward across deliveries. Missing product prices remain unresolved. Product matches still need suitability/allergen review.

The displayed budget is the subtotal of resolved lines only. Missing products and delivery/tax/tip charges are explicitly pending. Product-only amounts cannot authorize orders or Stripe payments. Certification prices are labeled test data. No synthetic item amounts appear in the shopping list, and failed lookups cannot fall back to sandbox prices.

Set `KROGER_ENVIRONMENT=certification` for credentials issued for Certification APIs. This uses `api-ce.kroger.com` and labels results as test data. Production credentials require `KROGER_ENVIRONMENT=production` (the default). Certification credentials do not provide real store prices or enable checkout.

Reference: [Kroger’s official public API collection](https://www.postman.com/kroger/the-kroger-co-s-public-workspace/documentation/ki6utqb/kroger-public-apis).

## What is deliberately gated

- **Live grocery ordering is disabled.** Real Kroger price reads require your credentials. Instacart’s public recipe/list API generates checkout links; it does not establish unattended ordering or a bounded final charge. Production access must verify pricing, slots, final-charge limits, substitutions, and idempotent order submission before replacing the sandbox provider.
- Stripe test Checkout is implemented, but a real Stripe test transaction needs your test secret key. No account credentials are included.
- Dietary exclusions are conservative recipe-text filters, not verified allergen or cross-contamination guarantees. Live checkout stays disabled.
- Meal changes after approval require reapproval. Once grocery submissions or checkout attempts exist, replacement is blocked rather than risking duplicate commitments.
- Kroger item totals use integer cents and whole retailer packages. A partial product subtotal is never treated as an all-in budget quote. Legacy sandbox logic is retained for historical records and isolated tests only.

## Checks

```sh
npm test
npm run typecheck
npm run build
npm run test:e2e
```

Browser tests use installed Chrome by default on macOS. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for another Chrome/Chromium path, or run `npx playwright install chromium` where Chrome is not installed. Tests cover budget boundaries, stale approvals, duplicate processing, source validation, payment identity/amount checks, and the browser planning/approval flow.

## Layout

- `app/`: App Router pages, responsive dashboard, authenticated API routes.
- `lib/domain.ts`: deterministic ingredient, budget, approval, and scheduling logic.
- `lib/db.ts`: SQLite/Turso transactional state; `lib/stripe.ts`: test-only payment integration.
- `lib/recipes.ts`: source retrieval and optional OpenAI browsing; `data/recipes.json`: dated source snapshots.

## Environment variables

See `.env.example`. Secrets remain server-only. `NEXT_PUBLIC_` secrets are never required. Keep `.env.local`, database files, and build output out of Git.

## Test checkout with Kroger prices

Use **Prepare test checkout** to create an explicit simulation quote. Real Kroger product prices remain unchanged in the shopping list. The simulation adds a $5 fixture per unique unpriced ingredient, $5.99 per nonempty delivery, 8% mock tax on groceries, and no tip. These are demo amounts, not Kroger quotes. The complete test total must fit the plan budget before approval or Stripe test checkout. Refreshing prices or swapping a meal invalidates the simulation and approval.

For AI-created plans, approve the proposed order to let the model invoke test payment and scheduled fulfillment. Legacy plans retain manual demo controls. Order IDs prefixed `sandbox_` are internal records, not Kroger orders. Live Stripe keys are rejected. No Kroger cart, order, delivery booking, or payment API mutation is called.

## Automatic ordering agent

New priced plans include a simulation quote automatically. **Approve week & order** is the final required action after planning: the server verifies approval and budget, creates and confirms a Stripe test PaymentIntent with `pm_card_visa`, then submits simulated orders when their scheduled times arrive. No card entry or hosted checkout is needed. The hourly GitHub runner retries pending payments and advances scheduled orders; approval also runs the agent immediately. Payment attempts have durable IDs and stable Stripe idempotency keys. Unpaid, paused, stale, or over-budget plans cannot submit orders. Ambiguous attempts older than 23 hours require review to avoid creating a second charge after idempotency expiration. Existing paid manual checkouts are reused. Grocery submissions remain internal `sandbox_` records, not Kroger orders.

## Model-driven agent and approval gates

With `OPENAI_API_KEY`, **Find my dinners** starts a durable Responses API tool loop using `gpt-6-luna` with medium reasoning (low reasoning for recipe web lookup). The model selects published recipe sources, retrieves ingredients, searches Kroger products, builds a basket, inspects alternatives, revises if needed, and calls `save_proposal`. Recipe discovery searches the public web using the latest preferences, feedback and query, then retrieves structured ingredients from actual publisher pages. Any public HTTPS publisher is supported; private network addresses and unsafe redirects are blocked. Search results are cached for 24 hours by preferences and feedback. Recipe planning and hosted web searches have no application call cap. Usage tracking includes model tokens and hosted search fees; caching avoids duplicate charges. Retrieved pages and products are untrusted data, not instructions. Server-side schemas enforce permitted recipes, products, dinner days, diet, and budget.

A separate **Approve week & order** resumes a model-driven execution loop. Its tools are bound to the approved plan ID and revision, with no model-supplied amount or arbitrary payment destination. The model inspects the order, invokes the idempotent test payment/scheduling executor, checks the result, and finishes. The existing hourly runner follows that authorized schedule without asking the model on every tick. Pause/revision/budget/payment guards remain enforced by code. Fulfillment is simulated; no real Kroger cart or order is created.

No cron job starts weekly planning. Only **Find my dinners** starts a planning run. Opening or refreshing the dashboard never invokes the model. Existing published plans remain available if the key is not configured. No hidden expensive recipe-discovery model path remains.

### Spend controls and persistence

- Fixed small model; 1,800 output tokens and 45 KB serialized request maximum per call; hosted recipe search is limited to one search per request, 6 KB input and 1,200 output tokens.
- Maximum 8 model turns per planning run, 4 per execution run. Failed/uncertain calls count against the limits.
- No daily or lifetime request cutoff. Calls and estimated costs remain tracked, including failed requests. Per-run turn limits, model input/output caps, and caching still limit unnecessary spending. OpenAI account billing limits remain independent; usage estimates exclude other applications and external calls.
- Recipe cache: 7 days; Kroger query cache: 15 minutes, keyed by environment, ZIP, and ingredient names; identical planning-model responses: 24 hours. Execution responses are never cached across runs.
- Turso tables persist agent runs, tool results, leases, cache entries, and token usage across deployments. No API keys, payment authority, or approval state is stored in localStorage. Concurrent runs use leases and unique indexes; model calls reserve budget before network requests.
- If interrupted, a run can resume from persisted tool results using **Resume if interrupted** or the scheduled runner. Failed runs stop visibly rather than silently burning credits. Network interruption after a model response but before persistence may require another counted model call; payment/order tools remain idempotent.

Reference: [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling), [model pricing](https://developers.openai.com/api/docs/models/gpt-6-luna).

## Google sign-in and first-time survey

Create a Web application OAuth client in Google Cloud → Google Auth Platform → Clients. Register `https://supper-club-umber.vercel.app/api/auth/google/callback` as its authorized redirect URI. Configure the consent screen and add your account as a test user while in Testing mode.

Set server-only `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_ALLOWED_EMAILS` (comma-separated allowed household emails) in Vercel and redeploy. `APP_URL` must be `https://supper-club-umber.vercel.app`; keep the existing `AUTH_SECRET`. Until credentials are configured, household password login stays available.

First-time Google identities complete a three-step preferences survey before the dashboard. Completion is persisted by Google account ID. Saving does not start AI research or ordering. The profile page displays Google-provided name/email and supports sign-out. This is still one private shared household: allowlisted members share preferences and plans, not separate tenant accounts.

## Navigation and delivery records

The kitchen sections have permanent routes: `/`, `/groceries`, `/deliveries`, and `/activity`. The order-completion dialog links to `/deliveries/<plan-id>`. That authenticated server-rendered page reads the saved week, delivery batches, grocery lines, payment status, and simulation order references from Turso; it does not depend on the currently selected week or browser storage. Unknown week IDs return 404. Status refreshes every 30 seconds while visible, and refresh never starts planning, pays, or submits an order. Fulfillment remains explicitly simulated.


## Simulated grocery provider

After the exact weekly quote is approved, the execution agent verifies a Stripe **test** payment and immediately creates persistent future delivery orders through `lib/simulated-provider.ts`. Order IDs are deterministic per delivery; retries reuse the payment attempt and never duplicate orders. Real purchases remain disabled.

New quotes require all ingredient prices. The former $5 missing-item fallback is removed. Missing products cause the planner to research another matching product or dinner. Simulated charges are $5.99 per nonempty delivery plus 8% tax and the user's configured tip; these are test fixtures, not Kroger checkout quotes. Basket changes invalidate the saved quote, and the server enforces the approved weekly cap.

Delivery records track Confirmed → Shopping → Out for delivery → Delivered. Events and timestamps persist in Turso. The authenticated scheduler processes them hourly (GitHub scheduling may be delayed); page reads also catch up elapsed events. In a delivery record, expand **Demo controls → Run fast delivery demo** to simulate shopping at 30 seconds, transit at 90 seconds, and delivery at 150 seconds. This changes only simulation timestamps and preserves the originally selected delivery date. No AI calls or real purchases are made by fast playback. Cancellation is available until transit; test cancellation does not issue a Stripe refund.

Regression coverage includes payment failure/retry, duplicate submissions, missing prices, expired slots, altered quotes, budget enforcement, cancellation, durable fulfillment catch-up, and the delivery page in Chrome.

Each confirmed delivery also has a **Next stage** control. It switches that delivery to manual progression (automatic timers stop), advances exactly one stage, and persists the result. Repeated requests with the same expected stage cannot skip a stage. Delivered/cancelled orders cannot advance. No AI requests, new payments, or new orders are triggered by this control.

Planning always advertises the basket/pricing tools, even before recipes are retrieved. Compact recipe summaries explicitly identify the full stored ingredients. Once every requested cuisine has a verified recipe, the planner must attempt a basket before reporting pricing as unavailable; an unrelated publisher 404 does not invalidate the catalog.
Product choices returned by a separate agent search can be applied to a basket only when the store/environment agree and the product description matches the original ingredient. Publisher measurement noise (unit labels, alternate metric quantities, and optional preparation notes) is removed before matching. Cached matches are versioned so old failures do not mask these fixes.

For an interrupted isolated live test, `LIVE_TEST_RUN_ID=<id> LIVE_TEST_URL=<local-url> npm run test:live` resumes that exact authorized planning run instead of paying to repeat discovery. It still verifies a fully priced, within-budget draft and never approves or pays.

The live action feed describes actual tool starts and results, including pricing failures and budget recovery. These are deterministic status summaries, not private model reasoning; they add no AI calls. A collapsed history remains with the saved proposal. New plans require a distinct dinner for each day (IDs, source URLs, and normalized titles are checked). Repeated meals are allowed only after an over-budget basket has triggered cheaper-recipe research, and are disclosed in the proposal summary.

Order approval opens an itemized review modal. Opening or cancelling the modal makes no approval request. Confirmation submits the exact reviewed plan ID/revision; the backend rejects stale revisions. Customer-facing order labels are normal commerce labels, accompanied by explicit demo-mode disclosure: real Kroger product reads, simulated payments/fees/fulfillment, no real grocery purchase.

During dinner search the main content is a live, high-level action transcript. A small authenticated progress endpoint reads persisted events once per second; full-state polling remains a fallback. Fetching recipe pages and checking the basket are separate recorded steps, so fast actions remain in the log rather than disappearing between polls. Once a fully priced proposal is saved, meal cards appear day by day; unvalidated candidates are never presented as approved dinners. Reduced-motion preferences disable entrance animations. The transcript remains available with the saved plan.
