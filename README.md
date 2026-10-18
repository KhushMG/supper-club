# Supper Club

A standard **Next.js App Router** application: cuisine preferences → actual published recipes → ingredient quantities → Kroger product matching and package prices → final-quote hold. Includes **Stripe test Checkout**, persistent household state, meal swaps, pantry quantities, delivery scheduling, and an activity log. No Edamam or paid recipe-data subscription.

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

Set `CRON_SECRET` to a random secret, then arrange an hourly authenticated `GET /api/jobs`:

```sh
curl -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/jobs"
```

This repository includes an hourly GitHub Actions scheduler. Set repository Actions secrets `APP_URL` and `CRON_SECRET` to activate it; they are configured for the current deployment. Use **Actions → Run dinner planner → Run workflow** for an immediate run. GitHub scheduled runs can be delayed, so delivery slots must still be checked at execution.

Alternatively, if your Vercel plan supports hourly cron, replace `vercel.json` with `vercel.cron.example.json` and redeploy. The default config deliberately does not require a paid cron tier. Any external scheduler that securely supplies the Authorization header also works. A configured secret alone does not mean scheduling is active; **Activity/Deliveries shows the last successful runner check-in**.

The runner drafts the next Monday–Sunday plan Friday after 9 a.m. in the household’s IANA timezone, with weekend catch-up. It never approves the draft. Legacy sandbox approved batches submit 24 hours before the target delivery time; Kroger-priced plans cannot submit without a final quote; arrival targets are one hour before cooking. Batches cover at most three days. Missed delivery windows are held for review. Repeated jobs do not create duplicate sandbox orders.

### Other deployment options

`npm run build && npm start` runs on any Node 22+ host. A Dockerfile is included. Use a libSQL-compatible Turso database for shared persistence or a mounted local SQLite volume on a single-server deployment. Run `/api/jobs` from your scheduler with its bearer secret.

## Recipe sources and optional AI

The checked-in recipe snapshots were extracted from actual Budget Bytes Recipe JSON-LD. Every card links to its source and shows retrieval time in its detail view. Recipe photos belong to the linked publisher. Full cooking instructions stay on the original site.

Without an AI key, generation refreshes matching published recipes directly, falling back to their dated snapshots if the source is temporarily unavailable. Ingredient lists without explicit quantities are rejected rather than guessed; this can mean a particular cuisine/diet has no eligible recipe. `npm run recipes:refresh` updates snapshots.

For broader browsing and free-text feedback, set `OPENAI_API_KEY` and optionally `OPENAI_MODEL`. The Responses API searches supported recipe publishers, then the app fetches the source Recipe JSON-LD itself. Recipe content cannot authorize purchases. API search usage may cost money; it is separate from the grocery budget. No Edamam account is used.

## Real store price lookup

Create a Kroger developer application with Products API access and set `KROGER_CLIENT_ID` and `KROGER_CLIENT_SECRET` on the server. Generation, swaps, and scheduled drafts populate the shopping list through `lib/kroger-basket.ts` and `lib/grocery-prices.ts`. **Refresh Kroger prices** reprices an existing unsubmitted plan and invalidates purchase approval. Open Stripe attempts and submitted orders block repricing.

Ingredient quantities are scaled to servings, grouped by delivery, and reduced by pantry stock. Container weights are preserved. Product searches require matching ingredient terms. Package counts round up using Kroger's actual package size and regular price. Incompatible dimensions (for example, recipe cups versus a product sold by weight), unknown package sizes, and missing matches remain unresolved; no density or price is guessed. Product matches still need suitability/allergen review. Cross-delivery surplus reuse is not assumed.

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
