# Carbon threat model

## What Carbon is and where untrusted input enters

Carbon is a multi-tenant manufacturing ERP (`apps/erp`) and shop-floor MES (`apps/mes`): React Router v7 server apps on Supabase (Postgres with row-level security, Auth, Storage), with background jobs on Inngest (`packages/jobs`). Many companies share one database. Every business table carries `companyId`, and RLS policies plus server-side checks keep each company's data apart.

Treat all of these as untrusted:

- **Authenticated users of another company.** Any signed-in user is untrusted with respect to every company they do not belong to, and to permissions their role lacks inside their own company (`requirePermissions`, `packages/auth`).
- **Login and session flows**: `apps/erp/app/routes/_public+` (login, magic link, MFA, invite, callback, refresh-session, unlock).
- **The public API and MCP server**: `apps/erp/app/routes/api+/v1+` (API-key authenticated, `api+/v1+/lib/authenticate.server.ts`), `api+/mcp+`, and the OAuth authorization server for MCP clients (`_oauth+`, `.well-known` routes).
- **Inbound webhooks**, each meant to verify its sender: `api+/webhook.*` (Stripe, Stripe Connect, Xero, QuickBooks, Ramp, Rillet, Jira, Linear, Onshape, Paperless Parts), `api+/integrations.slack.*`, and the Inngest endpoint `api+/inngest.ts`.
- **OAuth callbacks** for integrations (`api+/integrations.*.oauth.ts`): the `state` parameter and the code exchange.
- **Unauthenticated share pages** that read with elevated privileges: `routes/share+/*` (quotes, customer portal, RFQs, supplier quotes, SCARs, training) and token downloads (`routes/download.$token.tsx`). The URL token or id is the only credential.
- **The Onshape panel** (`routes/onshape+`): the one route that may be framed cross-site; it authenticates with its own bearer panel session, not the cookie.
- **File uploads and previews**: images, PDFs, CAD files and CSV imports (`packages/files`, `routes/file+`). The preview proxy authorizes by `companyId` in the storage path.
- **CAD files in the assembler** (`apps/assembler`, `crates/*`, Rust): an internal HTTP service. Every `/v1/*` route requires a bearer key (`ASSEMBLER_SERVICE_API_KEY`) unless `ASSEMBLER_DEV_MODE=true`, which is for local development only; `/health` is public, and `/events` is mounted only on AWS Lambda, where only an IAM-signed invoke reaches it. It downloads a user-uploaded STEP or GLB from a URL, parses it with OpenCASCADE through `cxx` bridges (`crates/occt-bridge`), converts, plans, optimizes or renders it, and uploads the result. The file content is fully attacker-controlled; the URLs come from Carbon but are checked by the service (`apps/assembler/src/http.rs`, `source.rs`).
- **Code a company writes**: configuration rules run in a QuickJS WebAssembly sandbox (`packages/database/src/configuration-rule.ts`), and workflow automations run conditions and actions (`packages/ee/src/workflows`, `packages/jobs/src/workflows`).
- **Text people type** that is later rendered (notes, rich text via tiptap, document templates, emails, PDFs).

## Components that matter most / least

Most important:
- Tenant isolation: RLS policies in `packages/database/supabase/migrations`, and every server path that uses the service-role client (`getCarbonServiceRole`, `asSystem`) where RLS does not apply. A query on the service role that is not scoped by `companyId` is the classic Carbon bug.
- Authentication and authorization: `packages/auth`, the API-key path, MCP and OAuth, MFA enforcement, invite and session handling.
- Share pages, token downloads and the storage preview proxy.
- Webhook signature checks and OAuth `state` handling.
- The configuration-rule sandbox and workflow execution.
- Accounting postings and payments (`apps/erp/app/modules/accounting`, `invoicing`): a bug that lets a user post or alter another company's ledger matters even without data theft.
- The assembler's parsers and native boundary: the `cxx` bridges into OpenCASCADE, FCL and Draco (`crates/occt-bridge`, `crates/collision`, `crates/draco-bridge`), GLB and meshopt decoding and the PNG encoder (`crates/thumbnail`, `crates/optimize`), and the source-URL checks and auth in `apps/assembler/src`.

Less important, still in scope: the academy app (`apps/academy`), the starter example (`apps/starter`), docs (`docs/`), and bugs inside OpenCASCADE, FCL or Draco themselves (report them, but say they are upstream).

Out of scope: `contrib/` (examples and deploy recipes), `.ai/` and `.claude/` (developer notes), generated files (`packages/database/src/types.ts`, swagger output), and local dev tooling (`packages/dev`).

## How to exercise it

- Unit tests: `pnpm run test` (Vitest through Turborepo), or one package: `pnpm --filter @carbon/auth test`, `pnpm --filter erp test`.
- Typecheck one package: `pnpm exec turbo run typecheck --filter=<package>`. A whole-repo typecheck runs out of memory.
- The database tests in `packages/database/supabase/tests` (pgTAP) need a running Supabase stack, which this image does not have. Read the RLS policies in the migrations directly, and read every migration that touches a table's policies: Postgres keeps each policy until a later migration drops or alters it by name, and permissive policies on one table combine with OR, so an older policy can still grant access.
- Route handlers are plain `loader`/`action` functions and can be read and tested without a server.
- Rust: the workspace is already built (dev profile, debug info) against static OpenCASCADE, FCL and Draco. Run `cargo test --workspace --offline`, or one crate: `cargo test -p converter --offline`. `crates/occt-bridge` has `write_test_step` for generating STEP fixtures; `cargo run -p thumbnail --example render -- in.glb out.png` renders a GLB. The service itself needs Redis (`REDIS_URL`), which this image does not run; call the crate functions directly instead.

## How we rate severity

- **Critical**: reading or writing another company's data; authentication bypass; taking over another user's account; remote code execution on the server, including through a crafted CAD file reaching memory corruption in the assembler; escaping the configuration-rule sandbox.
- **High**: privilege escalation inside a company (a role acting beyond its permissions, including reaching an admin-only action); a webhook or OAuth callback accepted without valid verification; a share or download token that can be guessed or reused beyond its intent; stored XSS that runs in another user's session in the ERP or MES; memory-safety bugs in the assembler (out-of-bounds read or write, use-after-free across a `cxx` bridge) without a demonstrated exploit; SSRF from the assembler's source or callback URLs that reaches internal services or returns their responses; calling the assembler without its bearer key.
- **Medium**: reflected XSS, CSRF on a state-changing action, SSRF limited to blind fetching, information disclosure inside the user's own company that their role should not see, open redirects that carry a token; a crafted CAD file that crashes the assembler or holds its memory admission so other companies' jobs stall.
- **Low**: denial of service that needs an authenticated user, missing security headers, verbose errors; a CAD file that is merely slow to convert within the service's limits.
- A finding that needs an attacker to hold the service-role key, database superuser access or a compromised deploy environment is out of scope: those are already full access. Application code that uses the service-role client (`getCarbonServiceRole`, `asSystem`) is in scope: a route that lets an ordinary user reach another company's rows through it is a critical tenant-isolation bug.

## Anything to leave alone

- Commercial features under `packages/ee` and `*.ee.*` files are in scope for security bugs; licence gating (plan or entitlement checks) is a business control, not a security boundary.
- Self-hosted defaults in `contrib/deploying` and `.env.example` files are examples, not deployments.
- Prefer a reproducer as a Vitest test or a short request sequence, with a patch that keeps the `companyId` scoping explicit.
