<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Required verification

Run browser end-to-end tests yourself with `npm run test:e2e` for every change before deployment, alongside `npm run typecheck` and `npm test`. For agent changes, cover realistic tool payloads and failure/recovery paths with regression tests. Use mocked external services to conserve API credits, then perform a read-only production browser smoke test after deployment.
