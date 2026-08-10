# Workflows Builder UX Overhaul — implementation plan

**Spec / source:** `.ai/specs/2026-07-31-workflows-builder-ux-overhaul.md`
**Rough notes:** `.ai/plans/automation/pending-changes.md`
**Branch:** `feat/automation`

## Progress

- [ ] Task 1: Remove HMAC signing from the webhook action and its tests
- [ ] Task 2: Remove `webhookSecret` from the ERP service, create route and form
- [ ] Task 3: Delete the webhook-secret migration and correct the three docs
- [ ] Task 4: Regenerate database types — **BLOCKED on the user resetting the local DB**
- [ ] Task 5: Show the workflow name in the breadcrumb
- [ ] Task 6: Add `expanded` to the node schema
- [ ] Task 7: Carry `expanded` through the builder, and flip node auto-placement
- [ ] Task 8: Drop the per-kind accent colours from `NODE_KIND_META`
- [ ] Task 9: Rewrite `NodeCard` — left/right handles, new handle styling, two states
- [ ] Task 10: Add the per-node `NodeMenu` (Minimize, Batch mode, Delete)
- [ ] Task 11: Rewrite `WorkflowNodeCard` — render the config form inline, drop LOD
- [ ] Task 12: Delete the config panel and go to a two-panel layout
- [ ] Task 13: Remove the batch Switch from `ActionForm`
- [ ] Task 14: Redesign `NodePalette`
- [ ] Task 15: End-to-end verification

## Dependencies

```
Track A (webhook secret)   1 ─┐
                           2 ─┼─► 3 ─► 4 (blocked on user)
Track B (breadcrumb)       5   (independent of everything)
Track C (builder)          6 ─► 7 ─┐
                           8 ───►  9 ─┐
                                  10 ─┼─► 11 ─► 12 ─► 14 ─► 15
                          13 (independent, any time after 12)
```

- **Tasks 1, 2, 5, 6, 8 are independent of one another** and may run as parallel
  subagents.
- Task 3 must land after 1 and 2 (it removes the docs describing what they delete).
- Task 4 cannot run until the user resets their local database — see its note.
- Task 9 needs 7 (the `expanded` flag) and 8 (accent gone).
- Task 11 needs 9 and 10. Task 12 needs 11. Task 14 needs 8.
- Task 15 is last and needs everything.

## Commands used in this plan (all verified present)

| Purpose | Command |
|---|---|
| Typecheck ERP | `pnpm exec turbo run typecheck --filter=erp` |
| Typecheck workflows | `pnpm exec turbo run typecheck --filter=@carbon/workflows` |
| Typecheck jobs | `pnpm exec turbo run typecheck --filter=@carbon/jobs` |
| Test a package | `pnpm --filter @carbon/workflows test` / `pnpm --filter @carbon/jobs test` |
| Test ERP (no `test` script — run vitest directly, from `apps/erp`) | `npx vitest run <path>` |
| Lint | `pnpm exec biome check` |
| Regenerate DB types | `pnpm run generate:types` |

> **`apps/erp` has no `test` script**, so `pnpm run test` (which is
> `turbo run test`) does **not** run `graph.test.ts`. ERP tests only run via
> `npx vitest run …` executed from the `apps/erp` directory. Verified: that
> command currently runs `graph.test.ts` green at 12 tests.

> **Never run a whole-repo typecheck.** `pnpm run typecheck` runs every package
> and OOMs. Always scope with `--filter`. The ERP package is named `erp`, **not**
> `@carbon/erp` — a wrong filter silently matches nothing and reports success.

---

## Task 1: Remove HMAC signing from the webhook action and its tests

**Depends on:** none

**Files:**
- Modify: `packages/jobs/src/workflows/actions/webhook.ts` — delete the secret read, the HMAC, and the two signing headers
- Modify: `packages/jobs/src/workflows/actions/webhook.test.ts` — delete the signature test, the no-secret test, and the secret plumbing in the fake client

**Steps:**

1. In `webhook.ts`, delete the `import { createHmac } from "node:crypto";` line
   (line 1) and the `const NO_SECRET = "This workflow has no signing secret.";`
   line.

2. Delete this whole block (the workflow row read and the signature computation):

   ```ts
   const workflow = await client
     .from("workflow")
     .select("webhookSecret")
     .eq("id", workflowId)
     .eq("companyId", companyId)
     .single();
   const secret = workflow.data?.webhookSecret;
   if (workflow.error !== null || !secret) {
     return { ok: false, error: NO_SECRET };
   }

   // Signed over the exact bytes sent, so the receiver can verify what it got.
   const rawBody = asText(inputs.body) ?? "";
   const timestamp = Math.floor(Date.now() / 1000);
   const signature = createHmac("sha256", secret)
     .update(`v1:${timestamp}:${rawBody}`)
     .digest("hex");
   ```

   and replace it with just the body read:

   ```ts
   const rawBody = asText(inputs.body) ?? "";
   ```

3. In the `fetch` call, delete the two signing headers so `headers` becomes
   exactly:

   ```ts
   headers: { "Content-Type": "application/json" },
   ```

4. `client`, `companyId` and `workflowId` are now unused inside the function body
   but **stay in the `params` type and the destructure** — `services.ts` passes
   them positionally by object key and the signature is shared with the other
   action runners. If `tsgo` reports them as unused errors (not warnings), prefix
   the destructured names with `_` rather than removing them from the type. If
   removing them from the type appears necessary, **STOP and report** — that
   changes a shared call signature.

5. In `webhook.test.ts`: delete the `import { createHmac } from "node:crypto";`
   line; change `function fakeClient(webhookSecret: string | null)` to
   `function fakeClient()` and remove the branch that returns
   `{ data: { webhookSecret }, error: null }` — the helper no longer needs to
   stub a workflow row read at all, so return whatever shape the remaining tests
   need for a client that is never queried. Update every `fakeClient(...)` call
   site to `fakeClient()`.

6. Delete the test that asserts the signature (the one reading
   `headers["Carbon-Timestamp"]` and asserting `headers["Carbon-Signature"]`) and
   the test named `"refuses when the workflow has no signing secret"`. Delete any
   now-unused `SECRET` constant.

7. Add one new test asserting the absence of signing, in the file's existing
   style:

   ```ts
   it("sends no signing headers", async () => {
     // ...drive a successful call the way the neighbouring success test does...
     expect(headers["Carbon-Signature"]).toBeUndefined();
     expect(headers["Carbon-Timestamp"]).toBeUndefined();
   });
   ```

**Verify:**
```bash
pnpm --filter @carbon/jobs test
# Expected: all tests pass; webhook.test.ts reports no failures.
pnpm exec turbo run typecheck --filter=@carbon/jobs
# Expected: exits 0, no errors.
grep -n "createHmac\|Carbon-Signature\|Carbon-Timestamp\|webhookSecret" packages/jobs/src/workflows/actions/webhook.ts packages/jobs/src/workflows/actions/webhook.test.ts
# Expected: matches ONLY inside the new "sends no signing headers" test.
```

**Out of scope:** `url-guard.ts` and every SSRF/https/redirect/timeout test — they
are unrelated to signing and must keep passing unchanged. Do not touch
`redactForLog` in `engine/ledger.ts` (its `/signature|secret|token/` redaction list
protects other columns). Do not touch the event-system `WEBHOOK` handler at
`packages/jobs/src/inngest/functions/events/webhook.ts`.

---

## Task 2: Remove `webhookSecret` from the ERP service, create route and form

**Depends on:** none

**Files:**
- Modify: `apps/erp/app/modules/workflows/workflows.service.ts` — `insertWorkflow` stops selecting the secret
- Modify: `apps/erp/app/routes/x+/workflows+/new.tsx` — stop returning the secret
- Modify: `apps/erp/app/modules/workflows/ui/WorkflowForm.tsx` — delete the reveal screen

**Steps:**

1. In `workflows.service.ts`, delete the two-line comment above `insertWorkflow`
   that reads:

   ```
   // Insert and update are separate rather than one `upsert*` because only the insert
   // may ever select `webhookSecret` back — it is shown once, at creation.
   ```

   and change `.select("id, webhookSecret")` to `.select("id")`. Leave
   `insertWorkflow` and `updateWorkflow` as two separate functions.

2. In `new.tsx`, replace the trailing return and its comment:

   ```ts
   // The webhook secret is returned once, for the create modal's success state.
   // There is no reveal-later route.
   return data(
     { id: created.data.id, webhookSecret: created.data.webhookSecret },
     { status: 201 }
   );
   ```

   with:

   ```ts
   return data({ id: created.data.id }, { status: 201 });
   ```

3. In `WorkflowForm.tsx`:
   - Delete the `type CreatedWorkflow = { id: string; webhookSecret: string };`
     declaration and change the fetcher to
     `useFetcher<{ id: string } | { success: false }>()`.
   - Delete the `dismissedSecret` state and the `created` computation.
   - Delete the entire `created ? ( … ) : (` branch — the whole "Workflow created"
     header, the secret `<code>` block, the Copy button and the "Open workflow"
     footer — leaving only the `ValidatedForm` that was in the `else` arm, no
     longer wrapped in a ternary.
   - Remove the now-unused imports: `copyToClipboard`, `toast`, `LuCopy`, and
     `HStack`/`VStack`/`useState` **only if** nothing in the remaining JSX still
     uses them. Check each before deleting; `HStack` is used by the form's footer.
   - Navigation after a successful create must still reach the new workflow.
     `useNavigate` is already imported and `path.to.workflow(id)` is the target.
     Add a `useEffect` that fires when `fetcher.data` has an `id`:

     ```ts
     useEffect(() => {
       if (fetcher.data && "id" in fetcher.data) {
         navigate(path.to.workflow(fetcher.data.id));
       }
     }, [fetcher.data, navigate]);
     ```

     If the surrounding list route already navigates on create, prefer that and
     skip this effect — check `apps/erp/app/routes/x+/workflows+/_index.tsx` and
     `WorkflowsTable.tsx` for an existing `onClose`/navigate path before adding a
     second one. **If both would navigate, STOP and report** rather than leaving a
     double navigation.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0, no errors.
grep -rn "webhookSecret" apps/erp/
# Expected: no matches.
```

**Out of scope:** `updateWorkflow` keeps its current shape. Do not touch
`apps/erp/app/routes/api+/webhook.xero.ts` — its `XERO_WEBHOOK_SECRET` is an
unrelated inbound integration key.

---

## Task 3: Delete the webhook-secret migration and correct the three docs

**Depends on:** Tasks 1, 2

**Files:**
- Delete: `packages/database/supabase/migrations/20260731025358_workflows-webhook-secret.sql`
- Modify: `.claude/rules/workflow-actions.md` — the signing section and the comparison table
- Modify: `packages/jobs/AGENTS.md` — line ~113, the `webhook.ts` table row
- Modify: `apps/erp/app/modules/workflows/AGENTS.md` — lines ~9 and ~65

**Steps:**

1. Confirm the migration is not on `main` before deleting:

   ```bash
   git cat-file -e main:packages/database/supabase/migrations/20260731025358_workflows-webhook-secret.sql 2>&1
   ```

   This must report that the path does not exist in `main`. **If it DOES exist on
   `main`, STOP and report** — the column then reached production and needs a
   drop migration instead, which is a different change.

2. Delete the migration file.

3. In `.claude/rules/workflow-actions.md`, rewrite the "The webhook action"
   section: remove the secret/`gen_random_bytes` paragraph, the signed-string code
   block, the `Carbon-Timestamp`/`Carbon-Signature` header block, the RLS caveat
   and the `"This workflow has no signing secret."` refusal. Keep everything about
   `redirect: "manual"`, the 10s timeout, the non-2xx handling, the `status`
   output, the 2048-byte excerpt, and the whole "The SSRF guard" subsection. In
   the three-webhook comparison table, change the workflow-action row's
   description from "Outbound, per-workflow HMAC, SSRF-guarded, https-only" to
   "Outbound, SSRF-guarded, https-only".

4. In `packages/jobs/AGENTS.md`, change the `webhook.ts` row to describe
   `runWebhookAction` without the HMAC clause — keep `redirect: "manual"`, the
   10s timeout and the 2 KB excerpt.

5. In `apps/erp/app/modules/workflows/AGENTS.md`:
   - Line ~9: remove `and a webhookSecret` from the Workflow entity description.
     Keep the rest of the sentence about `ownerId`, `active` and `activeVersionId`.
   - Line ~65: the bullet currently reads "`insertWorkflow` / `updateWorkflow` —
     separate rather than one `upsert*`, because only the insert may select
     `webhookSecret` back". That reason is now false. Replace it with a bullet
     that still documents both functions but states no secret-based reason.

**Verify:**
```bash
grep -rn "webhookSecret" apps packages .claude
# Expected: no matches.
grep -rni "Carbon-Signature\|signing secret" apps packages .claude
# Expected: no matches.
grep -rn "WEBHOOK_SECRET" packages/env/src/index.ts | wc -l
# Expected: 6 — the Stripe/Xero/QuickBooks integration keys are untouched.
```

**Out of scope:** every other migration file. Do not create a new migration.

---

## Task 4: Regenerate database types — BLOCKED on the user resetting the local DB

**Depends on:** Task 3, **and an explicit go-ahead from the user**

> ⚠️ **Do not start this task on your own initiative.** `pnpm run generate:types`
> reads the **live local database**, not the migration files. The user's local
> database already has the `webhookSecret` column applied, so running the
> generator before that database is reset would regenerate the column straight
> back in and silently undo Task 3's intent.
>
> `AGENTS.md` is explicit: **never rebuild the database to test changes — wait for
> the user.** Ask, then wait. Do not run any reset command yourself.

**Files:**
- Modify (generated — never hand-edit): `packages/database/src/types.ts`
- Modify (generated): `packages/database/src/swagger-docs-schema.ts`
- Modify (generated): `packages/database/supabase/functions/lib/types.ts`

**Steps:**

1. Ask the user to reset their local database so the deleted migration stops
   being applied. Wait for them to confirm it is done.
2. Run `pnpm run generate:types`.
3. Confirm the three generated files no longer mention `webhookSecret`. Do not
   hand-edit them under any circumstances — if the column is still present, the
   database was not reset; **STOP and report**.

**Verify:**
```bash
grep -rn "webhookSecret" packages/database/
# Expected: no matches.
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/jobs
# Expected: exits 0, no errors.
```

**Out of scope:** every other generated artifact. Do not run
`pnpm run generate:workflow-catalog` — the webhook action's declared inputs and
outputs are unchanged, so the catalog does not move.

---

## Task 5: Show the workflow name in the breadcrumb

**Depends on:** none

**Files:**
- Modify: `apps/erp/app/routes/x+/workflow+/$id.tsx` — add a `handle` export
- Copy from (precedent): `apps/erp/app/routes/x+/job+/$jobId.tsx` lines 67–73

**Steps:**

1. The route currently has **no** `handle` export. Add one directly above the
   `loader`, matching the job-detail precedent exactly:

   ```ts
   export const handle: Handle = {
     breadcrumb: detailBreadcrumb(
       { breadcrumb: msg`Workflows`, to: path.to.workflows },
       (data) => data?.workflow?.name
     ),
     module: "workflows"
   };
   ```

2. Add the imports this needs, matching how `$jobId.tsx` imports them:
   `import { msg } from "@lingui/core/macro";`,
   `import type { Handle } from "~/utils/handle";` and
   `import { detailBreadcrumb } from "~/utils/handle";`. `path` is already
   imported in this file.

3. Use `msg` from `@lingui/core/macro`, **never** `t` — `t` throws outside a
   locale provider, and a route `handle` is evaluated outside one. This is a
   documented repo rule.

4. Confirm `module: "workflows"` is the right value by checking what
   `apps/erp/app/routes/x+/workflow+/_layout.tsx` sets on its own `handle`. If
   the layout uses a different module string, match the layout.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0, no errors.
```
Then manually: open any workflow and confirm the breadcrumb reads
`Workflows / {that workflow's name}`, and that clicking `Workflows` returns to the
list.

**Out of scope:** `_layout.tsx` keeps its own `Workflows` breadcrumb — the helper
composes the two, so do not remove it.

---

## Task 6: Add `expanded` to the node schema

**Depends on:** none

**Files:**
- Modify: `packages/workflows/src/definition/schema.ts` — add the field to `nodeBase`

**Steps:**

1. Add one field to `nodeBase`, beside `position`:

   ```ts
   const nodeBase = {
     id: z.string().min(1),
     /** Customer-given name. Optional, so every stored definition still parses. */
     title: z.string().optional(),
     position: z.object({ x: z.number(), y: z.number() }),
     /** Presentation only. Default true, so every stored definition still parses. */
     expanded: z.boolean().default(true)
   };
   ```

2. **Leave `CURRENT_DEFINITION_FORMAT_VERSION` at `2`.** The field has a default,
   so every already-stored definition parses unchanged and reads as expanded. Do
   not bump it.

3. Run the package's tests. If any test asserts an exact parsed node object, it
   will now see an extra `expanded: true` key — update those expectations to
   include it. **If a test fails for any other reason, STOP and report.**

**Verify:**
```bash
pnpm --filter @carbon/workflows test
# Expected: all tests pass.
pnpm exec turbo run typecheck --filter=@carbon/workflows
# Expected: exits 0, no errors.
```

**Out of scope:** the runtime (`src/runtime/**`), the catalog, `sync.ts`, and the
engine in `packages/jobs`. `expanded` is presentation-only and nothing outside the
builder may read it.

---

## Task 7: Carry `expanded` through the builder, and flip node auto-placement

**Depends on:** Task 6

**Files:**
- Modify: `apps/erp/app/modules/workflows/types.ts` — add `expanded` to `BuilderNode`
- Modify: `apps/erp/app/modules/workflows/ui/Builder/graph.ts` — carry the flag; flip `nextNodePosition`
- Modify: `apps/erp/app/modules/workflows/ui/Builder/store.ts` — add `setNodeExpanded`
- Modify: `apps/erp/app/modules/workflows/ui/Builder/graph.test.ts` — cover both changes

**Steps:**

1. In `types.ts`, add `expanded` beside `title`:

   ```ts
   export type BuilderNode = Node<
     Record<string, unknown>,
     WorkflowNode["type"]
   > & {
     title?: string;
     expanded?: boolean;
   };
   ```

2. In `graph.ts` → `toBuilderNode`, carry the flag through, defaulting to
   expanded:

   ```ts
   return {
     id: node.id,
     type: node.type,
     position: node.position,
     ...(node.title !== undefined ? { title: node.title } : {}),
     expanded: node.expanded ?? true,
     data: node.data as Record<string, unknown>
   };
   ```

3. In `graph.ts` → `fromReactFlow`, include it in the serialized node, right after
   `position`:

   ```ts
   expanded: node.expanded ?? true,
   ```

4. In `graph.ts` → `createNode`, every one of the six `case` arms returns an
   object literal. Add `expanded: true` to each. (Six edits — `trigger`,
   `condition`, `entity`, `lookup`, `filter`, `action`.)

5. In `graph.ts`, change the layout constant and invert `nextNodePosition`.
   `NODE_WIDTH` becomes `440` to match the expanded card:

   ```ts
   const NODE_WIDTH = 440;
   ```

   and the placement rule flips from "below, nudge right" to "right, nudge down":

   ```ts
   const start = anchor
     ? { x: anchor.position.x + NODE_WIDTH + GAP_X, y: anchor.position.y }
     : { ...TRIGGER_POSITION };

   // ...collides() is unchanged...

   const position = { ...start };
   while (collides(position)) {
     position.y += NODE_HEIGHT + GAP_Y;
   }
   ```

   Also change the anchor fallback: it currently picks the node with the greatest
   `position.y` (the lowest). With a horizontal layout it must pick the greatest
   `position.x` (the rightmost):

   ```ts
   nodes.reduce<BuilderNode | undefined>(
     (rightmost, node) =>
       !rightmost || node.position.x > rightmost.position.x ? node : rightmost,
     undefined
   )
   ```

   Update the function's leading comment, which currently says "Below `from` (or
   below the lowest node), nudged right until nothing collides."

6. In `store.ts`, add a `setNodeExpanded` mutation. Put its signature in the store
   type beside `renameNode`, and implement it in the same shape as `renameNode`
   (which writes a sibling field, not `data`):

   ```ts
   setNodeExpanded: (id: string, expanded: boolean) => void;
   ```

   ```ts
   setNodeExpanded: (id, expanded) =>
     set(({ nodes }) => ({
       nodes: nodes.map((n) => (n.id === id ? { ...n, expanded } : n))
     })),
   ```

   Do **not** add an `isReadOnly` guard here — read-only mode hides the menu
   entirely (Task 10), and letting a viewer collapse a node locally would be
   harmless anyway. If the surrounding mutations all guard on `isReadOnly` and
   consistency matters more, match them.

7. In `graph.test.ts`, add tests for both behaviours:
   - A definition round-trips through `toReactFlow` → `fromReactFlow` preserving
     `expanded: false` on a node that had it.
   - A node parsed from a definition **without** `expanded` reads as `true`.
   - `nextNodePosition` with one anchor returns a position to its **right** (same
     `y`, greater `x`).
   - `nextNodePosition` nudges **down** when the position to the right is
     occupied.

**Verify:**
```bash
cd apps/erp && npx vitest run app/modules/workflows/ui/Builder/graph.test.ts
# Expected: all tests pass, including the 4 new ones (was 12 tests before).
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0, no errors.
```

**Out of scope:** `Autosave.tsx` — it diffs the serialized definition, so it picks
up `expanded` automatically once `fromReactFlow` emits it. Do not modify it.

---

## Task 8: Drop the per-kind accent colours from `NODE_KIND_META`

**Depends on:** none

**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/nodes/meta.ts` — remove `accent`

**Steps:**

1. Remove `accent: string;` from the `NodeKindMeta` type.
2. Remove the `accent: "#…"` line from all six entries (`trigger` `#f59e0b`,
   `condition` `#2563eb`, `action` `#059669`, `entity` `#7c3aed`, `lookup`
   `#0891b2`, `filter` `#db2777`).
3. Change nothing else in the file. `Icon`, `name`, `description`,
   `defaultTitle`, `hasTarget`, `catalogId`, `title`, `summary` and
   `NODE_KIND_ORDER` all stay exactly as they are — the icons and descriptions are
   what the redesign reads.

This will break `NodeCard.tsx`, `WorkflowNodeCard.tsx` and `NodePalette.tsx`,
which pass or read `accent`. Those are Tasks 9, 11 and 14. Typecheck will fail
until then; that is expected and is why this task's Verify is a grep, not a
typecheck.

**Verify:**
```bash
grep -rn "accent" apps/erp/app/modules/workflows/ui/Builder/nodes/meta.ts
# Expected: no matches.
grep -rn "#f59e0b\|#2563eb\|#059669\|#7c3aed\|#0891b2\|#db2777" apps/erp/app/modules/workflows/
# Expected: no matches.
```

**Out of scope:** do not introduce a replacement colour map. The theme's
`--primary` variable is the only accent from here on.

---

## Task 9: Rewrite `NodeCard` — left/right handles, new handle styling, two states

**Depends on:** Tasks 7, 8

**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/NodeCard.tsx` — full rewrite
- Copy from (precedent): the current `NodeCard.tsx` for its structure and the
  `Badge`/`cn` import style; `packages/react/src/` for any component you add

**Steps:**

1. Change the props: remove `accent: string`, remove `isCollapsed?: boolean`, add
   `isExpanded?: boolean` (default `true`) and `menu?: ReactNode` (the Task 10
   dropdown, rendered in the header's top-right corner).

2. Card shell — width switches on state, height is always intrinsic:

   ```tsx
   <div
     className={cn(
       "rounded-lg border bg-card shadow-sm transition-shadow",
       isExpanded ? "w-[440px]" : "w-[260px]",
       isSelected && "border-primary ring-2 ring-primary/20",
       hasIssues && "border-destructive ring-2 ring-destructive/20"
     )}
   >
   ```

   Selection now uses `ring-primary`, not `ring-foreground`.

3. Icon chip — theme colour, no inline `style`:

   ```tsx
   <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
     {icon}
   </div>
   ```

   Delete the `style={{ backgroundColor: accent }}` attribute entirely.

4. Header row: keep the kind label, the title and the issue `Badge` as they are.
   Render `{menu}` at the right end of that row, so the header becomes
   `icon | (kind + title + badge) | menu`. When minimized the header also shows
   the `summary` one-liner; when expanded it shows `description` — this is the
   existing conditional, with `isCollapsed` replaced by `!isExpanded`.

5. Body: render `children` only when `isExpanded`, inside a region that does not
   fight the canvas:

   ```tsx
   {isExpanded && children && (
     <div className="nodrag border-t px-2.5 py-2">{children}</div>
   )}
   ```

   The `nodrag` class is required — without it, dragging inside a text field moves
   the node instead of selecting text.

6. **Target handle moves to the left edge**, vertically centred:

   ```tsx
   {hasTarget && (
     <Handle type="target" position={Position.Left} id="in" className={HANDLE_CLASS} />
   )}
   ```

7. **Source handles move to the right edge**, one labelled row each. Replace the
   whole bottom `<div className="relative flex gap-1.5 px-2.5">` block with a
   vertical stack, each row right-aligned with its handle pinned to that row:

   ```tsx
   <div className={cn("flex flex-col", isExpanded ? "border-t py-1.5" : "pb-1")}>
     {ports.map((port) => (
       <div key={port.id} className="relative flex items-center justify-end px-2.5 py-1">
         {isExpanded && (
           <span className="text-[9.5px] text-muted-foreground">{port.label}</span>
         )}
         <Handle
           type="source"
           position={Position.Right}
           id={port.id}
           className={HANDLE_CLASS}
           style={{ top: "50%", right: -6 }}
         />
       </div>
     ))}
   </div>
   ```

   Each `<Handle>` is `position: absolute` (ReactFlow's own style) inside its
   `relative` row, so `top: "50%"` centres it on **that row** — which is what makes
   a label sit beside the handle it names.

8. Define the shared handle class once, above the component:

   ```tsx
   const HANDLE_CLASS =
     "!size-3 !border-2 !border-card !bg-primary transition-transform " +
     "hover:!scale-135 hover:!shadow-[0_0_0_4px_hsl(var(--primary)/0.18)]";
   ```

   The `!` prefixes are required — `@xyflow/react/dist/style.css` ships its own
   `.react-flow__handle` rules and would otherwise win. If Tailwind rejects
   `hover:!scale-135`, use `hover:!scale-[1.35]`.

9. Keep the `NodePort` type export unchanged — `WorkflowNodeCard` imports it.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: still fails, but ONLY in WorkflowNodeCard.tsx and NodePalette.tsx
# (Tasks 11 and 14). NodeCard.tsx itself must report no errors.
pnpm exec biome check apps/erp/app/modules/workflows/ui/Builder/NodeCard.tsx
# Expected: no error-severity findings.
```

**Out of scope:** `edges/WorkflowEdge.tsx` — `getSmoothStepPath` derives its
geometry from the `Position` values it is handed and needs no change. Do not
touch `getNodeHandles` in `@carbon/workflows`; handle **ids** are unchanged and
are shared with the validator.

---

## Task 10: Add the per-node `NodeMenu` (Minimize, Batch mode, Delete)

**Depends on:** Task 7

**Files:**
- Create: `apps/erp/app/modules/workflows/ui/Builder/nodes/NodeMenu.tsx`
- Copy from (precedent): `apps/erp/app/modules/workflows/ui/Builder/VersionMenu.tsx` — an existing dropdown in this exact folder; match its `DropdownMenu` imports and structure

**Steps:**

1. Read `VersionMenu.tsx` first and mirror its import list and component shape.
   The `DropdownMenu*` primitives come from `@carbon/react`.

2. Props: `{ node: BuilderNode }`. The component reads what it needs from the
   builder store itself (`useBuilderStore`), matching how other builder
   components do it.

3. Render nothing at all when read-only:

   ```tsx
   const isReadOnly = useBuilderStore((s) => s.isReadOnly);
   if (isReadOnly) return null;
   ```

4. Trigger: a ghost `IconButton` with `LuEllipsisVertical` from `react-icons/lu`,
   `size="sm"`, `aria-label` from ``t`Step options` `` (use
   `const { t } = useLingui();` from `@lingui/react/macro` — this is a component,
   so `useLingui` is correct and bare `t` from `@lingui/core/macro` is not).

5. Stop the trigger's pointer events reaching the canvas, or opening the menu will
   also select/drag the node. Put `className="nodrag nopan"` on the trigger and
   call `event.stopPropagation()` in its `onClick`.

6. Menu items, in this order:

   - **Minimize / Expand** — always present. Label is ``t`Minimize` `` when
     `node.expanded !== false`, else ``t`Expand` ``. Calls
     `setNodeExpanded(node.id, !(node.expanded ?? true))`.

   - **Batch mode** — only when `node.type === "action"` **and** the node's
     configured action is batchable. Resolve that from the catalog the same way
     `ActionForm.tsx` does — read how it obtains `actionDef` and its
     `actionDef.batchable` flag and reuse that exact lookup; do not invent a new
     one. Render it as a checked item reflecting `node.data.batch === true`,
     calling `updateNodeData(node.id, { batch: !currentBatch })`. Label:
     ``t`Run once for each item in the list` ``. When the action id is empty or
     not batchable, omit the item entirely.

   - **Delete** — present for every kind **except `trigger`**. Gate on
     `node.type !== "trigger"`, matching the existing `canDelete` rule the old
     `ConfigPanel` used and the `removeNode` guard in `store.ts`. Destructive
     styling, `LuTrash2` icon. Opens `DeleteNodeDialog` — do not call `removeNode`
     directly; the dialog is the existing confirm step.

7. Hold the dialog's open state locally and render it exactly as `ConfigPanel.tsx`
   did:

   ```tsx
   {deleteOpen && (
     <DeleteNodeDialog nodeId={node.id} onClose={() => setDeleteOpen(false)} />
   )}
   ```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: NodeMenu.tsx itself reports no errors (other files may still fail
# pending Tasks 11 and 14).
pnpm exec biome check apps/erp/app/modules/workflows/ui/Builder/nodes/NodeMenu.tsx
# Expected: no error-severity findings.
```

**Out of scope:** do not add Duplicate — it was explicitly cut. Do not modify
`DeleteNodeDialog.tsx`.

---

## Task 11: Rewrite `WorkflowNodeCard` — render the config form inline, drop LOD

**Depends on:** Tasks 9, 10

**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/nodes/WorkflowNodeCard.tsx`
- Modify: `apps/erp/app/modules/workflows/ui/Builder/constants.ts` — delete `LOD_ZOOM`

**Steps:**

1. Delete the LOD logic entirely: remove
   `const isCollapsed = useStore((state) => state.transform[2] < LOD_ZOOM);`, the
   `import { useStore } from "@xyflow/react";` (only if `useStore` is now unused),
   and the `import { LOD_ZOOM } from "../constants";`.

2. In `constants.ts`, delete the `LOD_ZOOM` export and its comment. Keep
   `NODE_DRAG_TYPE`.

3. Read the node's own flag and pass it down:

   ```tsx
   const builderNode = useBuilderStore((state) =>
     state.nodes.find((n) => n.id === id)
   );
   const isExpanded = builderNode?.expanded ?? true;
   ```

4. Pass `isExpanded={isExpanded}` and `menu={<NodeMenu node={builderNode} />}` to
   `NodeCard`, and delete the `accent={meta.accent}` and `isCollapsed={…}` props.
   Guard the menu on `builderNode` being defined.

5. Render the real configuration form as the card's children when expanded. Import
   the form map — at this point it is still at its original path:

   ```tsx
   import { NODE_FORMS } from "../panel/forms/index";
   import { NodeNameField } from "../panel/NodeNameField";
   ```

   (Task 12 moves that directory and updates these two imports.)

   Replace the current children — the summary `<p>` and the "Not configured yet"
   `<p>` — with the name field plus the form, keeping the failure-handle warning:

   ```tsx
   {isExpanded && builderNode && (
     <div className="space-y-3">
       <NodeNameField key={node.id} node={node} />
       <Form key={node.id} node={node} issues={nodeIssues} />
     </div>
   )}
   {hasFailureHandle && !hasFailureEdge && (
     <p className="mt-1 flex items-center gap-1 text-[10.5px] text-amber-600 dark:text-amber-400">
       <LuTriangleAlert className="size-3 shrink-0" />
       <Trans>Nothing happens if this fails</Trans>
     </p>
   )}
   ```

   where `const Form = NODE_FORMS[node.type];` and `nodeIssues` is the per-node
   issue list — `ConfigPanel.tsx` computed it as
   `issues.filter((i) => i.nodeId === node.id)`. The existing `issueCount`
   selector in this file already reads the same store slice; derive both from one
   selector rather than subscribing twice.

6. Keep `summary` — it still feeds `NodeCard`'s minimized state via the existing
   `summary` prop.

7. The component is wrapped in `memo`. It now subscribes to the node list, so
   confirm it still re-renders when its own node's data changes. If `memo` plus
   the store selector causes a stale card, prefer a narrower selector over
   removing `memo`. **If you cannot make it update without removing `memo`, STOP
   and report** — every node renders through this component and dropping
   memoization affects canvas performance.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: only NodePalette.tsx still fails (Task 14).
grep -rn "LOD_ZOOM" apps/erp/
# Expected: no matches.
```

**Out of scope:** the six form components' internals. They already take
`{ node, issues }` and write through `updateNodeData`; nothing about them assumed
a drawer.

---

## Task 12: Delete the config panel and go to a two-panel layout

**Depends on:** Task 11

**Files:**
- Delete: `apps/erp/app/modules/workflows/ui/Builder/panel/ConfigPanel.tsx`
- Rename: `apps/erp/app/modules/workflows/ui/Builder/panel/` → `apps/erp/app/modules/workflows/ui/Builder/config/`
- Modify: `apps/erp/app/modules/workflows/ui/Builder/WorkflowBuilder.tsx` — two panels
- Modify: `apps/erp/app/modules/workflows/ui/Builder/nodes/WorkflowNodeCard.tsx` — fix the two moved imports

**Steps:**

1. Delete `panel/ConfigPanel.tsx`.

2. Move the directory with git so history is preserved:

   ```bash
   git mv apps/erp/app/modules/workflows/ui/Builder/panel apps/erp/app/modules/workflows/ui/Builder/config
   ```

   `NodeNameField.tsx`, `ClauseRow.tsx` and `forms/` move unchanged.

3. Update every import that referenced the old path. Find them first:

   ```bash
   grep -rn "Builder/panel\|\.\./panel\|\./panel" apps/erp/app/modules/workflows/
   ```

   and rewrite each `panel/` segment to `config/`. Task 11's two imports in
   `WorkflowNodeCard.tsx` are among them.

4. In `WorkflowBuilder.tsx`:
   - Delete `import { ConfigPanel } from "./panel/ConfigPanel";`.
   - Delete the third `<ResizablePanel id="config" …>` block and the
     `<ResizableHandle withHandle />` that precedes it.
   - Change the canvas panel's `defaultSize` from `62` to `82`.
   - Change the palette panel to `defaultSize={18} minSize={14} maxSize={26}`
     (rows now carry two lines of text — Task 14).
   - Change `autoSaveId="workflow-builder"` to `autoSaveId="workflow-builder-v2"`.
     A stored three-panel layout under the old id would try to restore the panel
     that no longer exists.

5. Leave `setSelected` / `selectedNodeId` in place. Selection still drives the
   card's `isSelected` ring; it simply no longer drives a panel.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: only NodePalette.tsx still fails (Task 14).
grep -rn "ConfigPanel\|Builder/panel" apps/erp/
# Expected: no matches.
```

**Out of scope:** `IssuesPanel.tsx` is a separate slide-over and stays. Do not
remove `selectedNodeId` from the store.

---

## Task 13: Remove the batch Switch from `ActionForm`

**Depends on:** Task 12 (ordering only — the file moved in Task 12)

**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/config/forms/ActionForm.tsx`

**Steps:**

1. Delete **only** the `{actionDef.batchable && ( … )}` block containing the
   `<Switch>` and the "Run once for each item in the list" text (around line 491
   before the move). That control now lives in the node menu.

2. **Keep** the block immediately above it — the amber
   `{!isBatch && listMismatches.length > 0 && ( … )}` callout with the "Run once
   per item" button. It is a one-way contextual hint driven by the node's wired
   inputs, not a duplicate of the toggle.

3. Remove the `Switch` import if nothing else in the file uses it. Check first —
   `isBatch` and `listMismatches` are still used by the retained callout, so do
   not remove those.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: only NodePalette.tsx still fails (Task 14).
grep -n "Switch\|isBatch\|listMismatches" apps/erp/app/modules/workflows/ui/Builder/config/forms/ActionForm.tsx
# Expected: isBatch and listMismatches still present (the callout);
# no <Switch> usage remains.
```

**Out of scope:** the other five forms.

---

## Task 14: Redesign `NodePalette`

**Depends on:** Task 8

**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/NodePalette.tsx` — full rewrite

**Steps:**

1. Fix the resize bug. The root `<aside>` is currently
   `className="flex w-[118px] shrink-0 flex-col gap-1 border-r bg-background p-2"`.
   The fixed width and `shrink-0` are why the contents ignore the panel's size,
   and the `border-r` is the stray border that floats away from the panel edge.
   It becomes:

   ```tsx
   <aside className="flex h-full w-full flex-col gap-0.5 overflow-y-auto bg-background p-2">
   ```

2. Keep the heading, but give it room: `<Trans>Add a step</Trans>` with the
   existing muted-uppercase classes.

3. Each entry becomes an icon + name + description row, reading `meta.Icon` and
   `meta.description` (both already in `NODE_KIND_META`):

   ```tsx
   <button
     type="button"
     key={type}
     disabled={disabled}
     draggable={!disabled}
     onDragStart={(event) => {
       event.dataTransfer.setData(NODE_DRAG_TYPE, type);
       event.dataTransfer.effectAllowed = "move";
     }}
     onClick={() => addNode(type)}
     className={cn(
       "flex w-full items-start gap-2.5 rounded-md p-2 text-left transition-colors",
       disabled
         ? "cursor-not-allowed opacity-40"
         : "hover:bg-accent active:scale-[0.98]"
     )}
   >
     <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
       <meta.Icon className="size-3.5" />
     </span>
     <span className="min-w-0 flex-1">
       <span className="block text-xs font-medium">{meta.name}</span>
       <span className="block text-[10.5px] leading-snug text-muted-foreground">
         {meta.description}
       </span>
     </span>
   </button>
   ```

   Note `w-full` and `min-w-0` — those are what let the row track the panel width
   instead of overflowing. There is **no** colour swatch and **no** inline
   `style`; the icon chip uses the theme primary.

4. Preserve the existing trigger rule exactly: when a trigger already exists, the
   Trigger entry is `disabled` and wrapped in the `Tooltip` /`TooltipTrigger` /
   `TooltipContent` with `<Trans>A workflow can only have one trigger</Trans>`.
   Keep the `<span>` wrapper around the button inside `TooltipTrigger asChild` —
   a disabled button fires no pointer events, so the tooltip needs the wrapper.

5. Keep `NODE_KIND_ORDER` as the iteration source and `NODE_DRAG_TYPE` on
   dragstart — `WorkflowBuilder.onDrop` reads that exact key.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: exits 0, no errors — this is the last file that was failing.
pnpm exec biome check apps/erp/app/modules/workflows/
# Expected: no error-severity findings.
```

**Out of scope:** the palette stays hidden in read-only mode via the existing
`{!isReadOnly && …}` guard in `WorkflowBuilder.tsx` — do not move that logic into
this component.

---

## Task 15: End-to-end verification

**Depends on:** all previous tasks (Task 4 may still be pending on the user)

**Steps:**

1. Full scoped checks:

   ```bash
   pnpm exec turbo run typecheck --filter=erp --filter=@carbon/workflows --filter=@carbon/jobs
   pnpm exec biome check
   pnpm --filter @carbon/workflows test
   pnpm --filter @carbon/jobs test
   cd apps/erp && npx vitest run app/modules/workflows/ && cd ../..
   ```

   Expected: every command exits 0. For `biome check`, compare against the
   pre-existing warning count — only **error**-severity findings block. This repo
   carries roughly 419 pre-existing warnings; do not try to fix them.

2. Confirm the removal is complete and the unrelated keys survived:

   ```bash
   grep -rn "webhookSecret" apps packages .claude          # expect: no matches
   grep -rn "WEBHOOK_SECRET" packages/env/src/index.ts | wc -l   # expect: 6
   ```

3. Drive the real app and check each acceptance criterion from the spec's
   "Builder" section (numbers 9–22). Use the `run` skill to start the app and the
   `auth` / `test` skills to drive it, with the user's permission. At minimum:
   - Create a workflow → no secret is shown, you land in the builder.
   - Breadcrumb reads `Workflows / {name}`.
   - Only two panels; no config drawer in the DOM.
   - Configure an action node inside the card; reload; the values persisted.
   - Zoom 0.25 → 2.0 changes no node's state.
   - Minimize a node; reload; it is still minimized.
   - The ⋮ menu shows Batch mode on a batchable action node and not on a
     condition; shows no Delete on the trigger.
   - Handles are on the left/right edges, are easy to grab, and ring on hover.
   - A condition node's three outputs each sit beside their own label.
   - Typing in a node field does not drag it; scrolling a combobox does not zoom.
   - Palette rows show icon + name + description and resize with the divider.
   - Switching the company theme recolours nodes and palette icons.
   - Open the published (read-only) version: no palette, no ⋮, no dragging.

4. Load a workflow that was saved **before** this change and confirm every node
   comes back expanded with no new validation issues.

5. Report results honestly. If a criterion fails, say which one and show the
   output — do not describe the work as complete with a known failure outstanding.

**Out of scope:** committing. Do not commit or push; the user commits on explicit
request.
