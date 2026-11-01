# Integrations as a first-class node + vendor config by table

Follow-on to `.ai/plans/2026-08-27-workflow-integrations.md`, which shipped Google Calendar
as an `action` node. Two changes, in this order:

- **A.** Per-vendor facts move out of shared code into the allowlist, so adding a vendor
  edits no shared file.
- **B.** `integration` becomes its own workflow node type with its own catalog, so the
  action path stops carrying a piece concept at all.

Both are prerequisites for adding 5–7 more vendors without repeating the same edits per
vendor. Nothing here is customer-visible on an existing workflow: the feature has not
shipped, so no stored definition contains an integration step.

## Decisions taken

1. **Integration steps leave `WORKFLOW_ACTION_CATALOG`** and get their own generated
   catalog. The action count returns to 16 and the action picker stops listing
   "Google Calendar: Create Event".
2. **One `Integration` palette entry**, not one per vendor. The vendor and its step are
   chosen inside the node, so the palette stays a fixed list of six kinds however many
   vendors exist.
3. **No format-version bump and no data migration.** Adding a node variant leaves every
   stored v3 document valid. Integration steps saved on a developer's local database
   during the first pass keep parsing but reference an action id the catalog no longer
   has, so they surface as a normal validation issue — re-create those few test nodes.
   If we ever ship an integration action node before B lands, this decision reverses and
   a v3 → v4 migration is required.
4. **API-key pieces stay unsupported** and are commented as such, not worked around.

## What is true today (grounded)

- Node kinds are `trigger | condition | compute | lookup | filter | action`
  (`packages/workflows/src/definition/schema.ts`), one `z.literal` variant each.
- Each kind has exactly one executor in `packages/workflows/src/runtime/`, registered in
  `runtime/executors.ts`. A kind with no entry refuses to execute — that is how `trigger`
  is recorded but never run.
- What an `action` node can DO is the 18-entry action catalog; the per-action
  implementations live in `packages/jobs/src/workflows/actions/`, including the existing
  `integration.ts` executor.
- The builder mirrors the kind list in five exhaustive
  `Record<WorkflowNodeType, …>` maps — `nodes/index.ts` (`nodeTypes`), `nodes/meta.ts`
  (`NODE_KIND_META`), and `nodes/kinds.ts` (`NODE_CARD_WIDTH`, `NODE_CARD_HEIGHT`,
  `NODE_ACCEPTS_INCOMING`) — plus one form per kind in `config/forms/`.
  **These five maps are the work list**: adding the type makes TypeScript name every one.
- `workflowStepRun."nodeType"` is plain `TEXT` (`20260810100100_workflows-foundation.sql`),
  so a new kind needs no migration.
- Per-vendor code lives in exactly three places today, all `google-calendar`-shaped:
  `oauthCredentials` in `packages/jobs/src/workflows/integrations/oauth.ts`, the direct
  `GOOGLE_OAUTH_*` reads in `apps/erp/app/routes/api+/integrations.connections.$piece.connect.ts`,
  and `accountLabelFor` in `apps/erp/app/routes/api+/integrations.connections.callback.ts`.

---

## Workstream A — vendor facts by table

Small, self-contained, no behaviour change for Google Calendar. Do it first: B is easier
to review when no vendor names are left in shared code.

- [x] **A1.** Extend `AllowlistEntry` in `integrations/allowlist.ts` with the vendor's own
      configuration: the NAMES of its three env vars (`clientIdEnv`, `clientSecretEnv`,
      `redirectUrlEnv`) and an optional `accountLabel` describing how to read back which
      account was connected (`{ url, field }` — Google's is
      `https://www.googleapis.com/oauth2/v2/userinfo` / `email`). Names, not values: the
      allowlist is imported by build-time scripts and must stay free of secrets.
- [x] **A2.** Add `resolveOAuthEnv(entry)` to `integrations/oauth.ts` reading
      `process.env` by those names, and delete the `if (pieceName === "google-calendar")`
      branch. Keep the existing refusal — `No OAuth app is configured for ${pieceName}.` —
      so an unconfigured server still fails loudly rather than half-working.
- [x] **A3.** Point the connect route at the same resolver instead of reading
      `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_REDIRECT_URL` directly.
- [x] **A4.** Make `accountLabelFor` read `entry.accountLabel` and drop its
      `if (pieceName !== "google-calendar") return null;`. Stays best-effort: a failure
      here must never lose a connection that already authorized.
- [x] **A5.** The settings card still needs a client id in the BROWSER to decide
      "Coming soon". `getBrowserEnv()` is a fixed list, so a per-vendor env var cannot be
      looked up dynamically there. Add each new vendor's client id to `getBrowserEnv()` and
      to the `Window.env` declaration when it is added — call this out in the checklist
      rather than inventing a dynamic mechanism.
- [x] **A6.** Comment `PIECE_ALLOWLIST` and `getPieceOAuth2Auth` with the v1 auth limit:
      **only OAuth2 pieces are supported**; a piece whose auth is `SECRET_TEXT`,
      `BASIC_AUTH` or `CUSTOM_AUTH` is refused by `UnsupportedPieceAuthError` and needs its
      own design (an API-key entry form, no callback, no refresh). Say why, so the next
      developer does not read it as an oversight.
- [x] **A7.** Add every integration env var that is currently undocumented to
      `.env.example` — `XERO_*`, `QUICKBOOKS_*`, `JIRA_*`, `ONSHAPE_*`, `SLACK_*`,
      `LINEAR_*`. Today only `SLACK_BOT_TOKEN` and `GOOGLE_OAUTH_*` are listed, so the rest
      are undiscoverable without reading `packages/env/src/index.ts`.

**Verify A:** `pnpm --filter @carbon/jobs test`, `pnpm exec turbo run typecheck --filter=@carbon/jobs --filter=erp`,
and connect Google Calendar end to end — the flow must be byte-identical to today.

---

## Workstream B — `integration` as its own node type

### B1. Definition and catalog

- [x] Add the `integration` variant to `definition/schema.ts`:
      `{ type: "integration", data: { piece, action, inputs } }`. The connection stays an
      ordinary input (`connectionId`) so the generic options provider keeps serving it.
      No `formatVersion` bump (decision 3).
- [x] New `CatalogIntegration` type + `WORKFLOW_INTEGRATION_CATALOG`, generated into
      `packages/workflows/src/catalog/integrations.generated.ts` by the SAME
      `buildPieceActionDeclarations()`, and merged by neither generator into the actions map.
      `scripts/generate-workflow-catalog.ts` and `scripts/check-workflow-catalog.ts` both
      stop merging pieces into `WORKFLOW_ACTIONS` and start emitting/checking the new file.
      Expect the reported counts to go `18 actions` → `16 actions, 2 integration steps`.
- [x] Delete the `piece` field from `ActionDeclarationLike` / `BuiltAction` and the
      `route.piece` branch from `getActionRoute`. If TypeScript still finds a piece concept
      on the action path after this step, the split is not done.
- [x] Extract the shared "validate inputs against a catalog entry" logic in
      `definition/validate.ts` so the integration node reuses it rather than growing a
      second copy — required inputs, type match, `dependsOn` sanity.

### B2. Runtime

- [x] New `packages/workflows/src/runtime/integration.ts` (`integrationExecutor`),
      registered in `runtime/executors.ts`. `permission()` returns `workflows_update`, the
      same gate the catalog entry carries today.
- [x] It resolves inputs, then delegates through `ctx.services` to the existing
      `packages/jobs/src/workflows/actions/integration.ts` — which keeps its two-client
      token read UNCHANGED (owner's client for the tenancy check, service role for the
      vault). That code is the security boundary; this workstream must not touch it.
- [x] `engine/execute.ts` and `engine/walk.ts` write `nodeType: "integration"` on the step
      row. No DB change (`nodeType` is TEXT).
- [x] Remove the `route.piece` dispatch from `actions/services.ts`, since nothing reaches
      it through an action any more.

### B3. Builder

- [x] Five exhaustive maps: `nodeTypes`, `NODE_KIND_META` (plug icon, name, description),
      `NODE_CARD_WIDTH`, `NODE_CARD_HEIGHT`, `NODE_ACCEPTS_INCOMING` (true). TypeScript
      names each one — work through the errors rather than searching.
- [x] New `config/forms/IntegrationNodeForm.tsx` — deliberately NOT `IntegrationForm`,
      which is the settings drawer's component. Vendor picker → step picker → the same
      `OptionsField` / `ValueField` inputs the action form already renders. Changing the
      vendor clears the step and the inputs, the same way changing the action does.
- [x] Register it in `config/forms/index.ts`, and add the label keys
      (`labelKeys.ts` `isDefaultNodeName` / `nodeTitle`) so a new node reads
      `integration_0` and the card names the vendor and step.
- [x] Check the node-type branches in `ports.ts`, `selectors.ts`, `store.ts`,
      `WorkflowNodeCard.tsx` and `definition/order.ts` — most are trigger-vs-rest and need
      nothing, but each must be READ rather than assumed.

### B4. Run history

- [x] `ui/Runs/WorkflowRunSteps.tsx` and `useNodeLabel.ts` learn the kind, so a step reads
      "Google Calendar: Create event" and not a raw id. `topologicalNodeOrder` is
      type-agnostic apart from the trigger and should need nothing — confirm.

**Verify B:** regenerate + check the catalog, `typecheck` across `@carbon/workflows`,
`@carbon/jobs`, `@carbon/ee`, `erp`, all four test suites, `biome check` on changed files.
Then in a browser: drop an Integration node, pick Google Calendar, pick the connection, pick
a calendar, test-run it, and confirm the run-history step row names it correctly.

---

## Risks

- **The five `Record<WorkflowNodeType, …>` maps are the whole risk surface in the builder,
  and TypeScript catches every one.** The genuinely uncatchable part is the branch-on-type
  code in B3's last item, which compiles fine while silently treating an integration node
  as "some other kind".
- **Do not let B touch the token path.** The tenancy check + service-role vault read in
  `actions/integration.ts` is the security boundary; it moves callers, not contents.
- Catalog counts appear in `.claude/rules/workflow-actions.md` and
  `workflow-event-catalog.md` and will need updating with the 18 → 16 change.
