paths:
  - "packages/ee/**"
  - "apps/erp/app/routes/x+/settings+/**"
  - "apps/erp/app/modules/users/**"

# Commercial Feature Licensing & Entitlement Pattern

How Carbon gates commercial (Enterprise/Business) features so they cannot be
unlocked by editing open-licensed code. Grounded against `packages/ee/src/plan.ts`,
`plan.server.ts`, `entitlements.server.ts`, and the reference implementations
(`packages/ee/src/permissions.server.ts`, `console.server.ts`, `approvals/`).

## The license boundary

Carbon is open-core. The commercial license (root `LICENSE`) covers **`packages/ee`
and every file whose name contains `.ee`** (e.g. `accounting.ee.service.ts`). Everything
else is community-licensed. This is the same model as Twenty CRM (their marker is a
`/* @license Enterprise */` header; ours is the `packages/ee` package + the `.ee` infix).

## The bar this pattern hits (be honest about it)

You cannot make a machine refuse to run code its operator has edited. What the pattern
guarantees is: **there is no route around the paywall that stays in open-licensed code.**
Using a commercial feature requires either executing commercial code or editing commercial
code — both are license breaches. A deletable `if` in a community-licensed route is NOT a
lock; a check inside `packages/ee` is.

## The three rules

1. **The feature body lives in `packages/ee`.** The service/engine that *does* the thing
   is commercial. Community code may call into it but must never reimplement it — so using
   the feature requires running commercial code.
2. **The entitlement check lives INSIDE the ee function**, via `requireEntitlement` — not
   as a call in the open route. So stripping the gate requires editing commercial code.
3. **UI is `.ee.tsx` in the app module. Gated features stay VISIBLE with an upgrade
   OVERLAY — never hidden from the nav, never redirected away.** The nav entry always
   renders; the gated list/editor route renders an upgrade overlay via
   `usePlanGate({ feature })` (`if (isGated) return <FeatureUpgradeOverlay />`), using the
   shared `~/components/RulesUpgradeOverlay` (blurred mock preview + copy) or the lower-level
   `~/components/UpgradeOverlay` primitives. This is UX — the server ee check is the
   enforcement. Reference: `x+/sales+/sales-rules.tsx` + `SalesRulesUpgradeOverlay`.

## The API — three helpers, know which to use

All in `@carbon/ee`. `FEATURE_PLANS` (`plan.ts`) is the source of truth for which plans
grant which `Feature`; every helper reads it.

| Helper | Shape | Where | Use for |
|---|---|---|---|
| `companyHasFeature(client, companyId, { feature })` | `Promise<boolean>` | `plan.server` | RUNTIME paths that must DEGRADE (feature off = no-op), not throw |
| `requireEntitlement(client, companyId, feature)` | throws `EntitlementError` | `entitlements.server` | **The LOCK.** Top of every commercial AUTHORING function, inside `packages/ee` |
| `requireFeature({ request, client, companyId, redirectTo, feature })` | throws a `redirect` | `plan.server` | UX only, in the open route loader/action — a friendly upgrade redirect |

- `companyHasFeature` semantics: **Community edition → false (blocked)**; Enterprise/Test
  self-hosted → true; Cloud → plan-based; bypass/carbon-owned → true. It is the ONE place
  the future license-key server plugs in (a signed, server-bound validity token) — so every
  feature inherits it without a call-site change.
- Do NOT use `companyHasPlan`/`requirePlan` for community-gated features — those no-op off
  Cloud (a self-hosted feature toggle), so a self-hosted Community instance would pass.
  They remain only for features that are Cloud-paywall-only.

## The two layers (both, deliberately)

- **Route (open, UX):** `requireFeature({ ..., feature: "X" })` in the loader/action →
  redirect with an upgrade flash. Strippable, cosmetic.
- **ee (commercial, LOCK):** `requireEntitlement(client, companyId, "X")` at the top of the
  ee function → throws `EntitlementError`. Un-strippable without editing commercial code.

**Route wiring for the visible+overlay UX:** the primary list/editor route's LOADER must NOT
`requireFeature`-redirect (that would hide the page) — let it load and render the overlay
client-side. Keep `requireFeature` on the WRITE routes/actions (`new`/`$id`/`delete`), which
are only reachable by direct URL when gated; a redirect there is fine. The write action
should catch `EntitlementError` or sit behind its `requireFeature` so the ee throw never
surfaces as a raw 500.

## File-layout convention

```
packages/ee/src/<feature>/
├── models.ts     # zod validators + const types (client-safe: @carbon/database, zod)
├── service.ts    # the engine — requireEntitlement at the top of authoring fns (server)
├── types.ts      # derived types (ReturnType<service>, input types) — type-only
└── index.ts      # export * from "./models"; export type * from "./types"
```
Exports in `packages/ee/package.json`: `@carbon/ee/<feature>` → `index.ts` (client-safe),
`@carbon/ee/<feature>.server` → `service.ts` (server). Small features may be a single
`<feature>.server.ts` (see `permissions.server.ts`, `console.server.ts`).

UI stays `.ee.tsx` in `apps/erp/app/modules/<module>/ui/` (coupled to `~/components/Form`,
`~/hooks` — cannot move to the package, and does not need to). Routes stay in the app.

## Refactor checklist (per feature)

1. Add/confirm the `Feature` key in `FEATURE_PLANS` (`plan.ts`).
2. Move the feature's service/engine into `packages/ee/src/<feature>/` (or a
   `<feature>.server.ts`). Fix `~/` deps: `sanitize` → `@carbon/utils`; redefine any
   `~/utils/query` types locally; keep `trigger()`/notification calls in the ROUTE, not the
   ee function (`@carbon/ee` does not depend on `@carbon/jobs`/`@carbon/notifications`).
3. **Embed `requireEntitlement(client, companyId, "X")` at the top of every authoring
   function.** Runtime functions that must degrade use `companyHasFeature` instead.
4. Move the feature's validators/derived types with it; add the package exports.
5. Repoint every call site from `~/modules/...` to `@carbon/ee/<feature>` / `.server`.
   Remove the moved code from the community module + its barrel.
6. UI → `.ee.tsx`. Route → keep `requireFeature` for the UX redirect + catch
   `EntitlementError`.
7. Verify: `pnpm --filter @carbon/ee typecheck`, `pnpm exec turbo run typecheck --filter=erp`,
   Biome, and if service functions leave `*.service.ts` note the MCP digest changes
   (`pnpm run generate:mcp`) — moving a function out of a scanned `*.service.ts` removes it
   as an MCP tool, which is usually correct (an ungated MCP path would bypass the gate).

## Rollout status (starter-only → new pattern)

Refactor one at a time; each PR should leave the tree green.

- ✅ **Permissions authoring / console** — body in `packages/ee` (`permissions.server.ts`,
  `console.server.ts`); `requireEntitlement` embedded in every authoring function
  (employee-type CRUD, `updateEmployee`, `updatePermissions`, `updateConsoleSetting`).
- ✅ **Approvals** — reference implementation (`packages/ee/src/approvals/`);
  `requireEntitlement` in `upsertApprovalRule`/`deleteApprovalRule`, graceful degrade in
  `getApprovalRuleByAmount`.
- ⬜ **Backups** — engine still in `packages/jobs`; gated via `canManageBackups` only
  (route-level). Biggest lift — relocate the engine last.
- ⬜ The Cloud-paywall features still on `requirePlan`/`companyHasPlan` (workflows, api keys,
  webhooks, sales/storage rules, audit log, forecast, customer portals, AI agent, 2FA,
  integrations) — migrate to `companyHasFeature`/`requireEntitlement` + move bodies into
  `packages/ee` feature-by-feature.

## Bundling gotcha — the `.server` client-graph boundary

The ee feature files import `entitlements.server`/`plan.server` (both `.server`), so
the ee `service.ts` is transitively server-only. The React Router build **rejects any
`.server` module that reaches the client graph** ("Server-only module referenced by
client"). Two edges commonly (and silently — typecheck won't catch it, only the dev
build does) pull the server file into the client:

1. **The client barrel deriving types from the server file.** If `index.ts`
   (`@carbon/ee/<feature>`) re-exports types from `types.ts`, and `types.ts` does
   `import type … from "./service"` (e.g. `ApprovalRule = ReturnType<getApprovalRuleByAmount>`),
   the client barrel transitively reaches `service.ts`. **Fix:** derive those types from
   `@carbon/database` directly (`Database["public"]["Tables"|"Views"][…]["Row"]`), so
   `types.ts` never imports `service.ts`.
2. **A `.service.ts` importing `@carbon/ee/<feature>.server`.** Module `*.service.ts`
   files are re-exported through the module barrel that client components import, so they
   are browser-bundled — importing a `.server` module there reaches the client graph.
   **Fix:** move that server-only helper into a `*.server.ts` (not barrel-exported) and
   import it from the route directly. (Routes MAY import `.server` — RR strips it from the
   client build; `*.service.ts` may NOT.)

## Anti-patterns

- A gate that is only a `usePlanGate` client check, or only a `requireFeature`/
  `requirePlan` call in an open route file, with the feature body in community code. That is
  UX, not a lock — deletable without breaching the license.
- Reimplementing a commercial engine in community code "to avoid the import." That removes
  the moat.
- Putting `requireEntitlement` in an open (`apps/erp`) file. It must live in `packages/ee`.
- **Hiding a gated feature from the nav, or redirecting its page away.** Gated features stay
  visible and show the upgrade overlay (rule 3). Hiding it makes the feature undiscoverable
  and gives the customer nothing to upgrade toward.
