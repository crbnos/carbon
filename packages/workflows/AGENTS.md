# @carbon/workflows

The shared contract for a **workflow definition** — the zod schema, the read-time
normaliser, and the validator that decides whether a workflow may be activated.

"Workflow" here means the customer-facing feature: a "when this happens, do that" rule a customer
builds on a canvas. It is **not** the generic sense used by the `.claude/rules/workflow-*.md`
developer-procedure files, and unrelated to `nonConformanceWorkflow`.

Spec: `.ai/specs/2026-07-30-workflows-foundation.md`.

## Always

- Change the schema **here**, never in a consumer. The builder (phase 7), the activation gate
  (phase 7) and the engine (phase 4) all read this one package — if any of them can disagree about
  what is valid, a customer can activate something broken and it will act on real records.
- Turn a stored row into a definition with `readWorkflowVersion(row)`. It is the single boundary
  where untyped JSON becomes the typed model, and it returns `{ok: true, definition}` or
  `{ok: false, failure, message}` — never a blank canvas standing in for a row it could not read,
  because the builder would then save over a definition nobody could see.
- Upgrade an older stored shape only inside `migrateDefinition` in `src/definition/normalize.ts`.
  It is private, pass-through at v1, and runs on the **raw JSON before** the current-schema parse —
  a document old enough to need upgrading cannot satisfy the current schema, so migrating after that
  parse could never run.
- Bump `CURRENT_DEFINITION_FORMAT_VERSION` when the stored shape changes, and add the upgrade to
  `migrateDefinition` in the same change.
- Pass a `WorkflowCatalog` into `validateDefinition`. Phases 2 and 5 supply the real event and
  action catalogs; `createFixtureCatalog()` is for tests only.
- Add a node type by adding one entry to `NODE_KINDS` in `src/definition/nodes.ts`. The mapped type
  makes a missing entry a compile error, which is the only thing stopping a new node type from
  validating clean with no handles and no checks at all.
- Take operator names from `Operator` in `@carbon/utils` — Carbon's one condition vocabulary, shared
  with storage rules. `OPERATORS_BY_TYPE` decides which of them a workflow may use where; it does not
  invent names.
- Keep zod unions **flat** and avoid recursive generics. `apps/erp` sits near TypeScript's
  instantiation budget, so new type surface here can trip TS2589 in unrelated files.

## Never

- Never import from `@carbon/database`, `@carbon/react`, or anything app-specific. The only runtime
  dependencies are `zod` and `@carbon/utils` (itself client-safe), which is what lets both the
  browser builder and the server engine use this package.
- Never let a stored node/edge shape reach a consumer without going through the schema.
- Never represent a list of lists — a list's `of` accepts scalars only, by construction.

## Layout

```
src/definition/
├── types.ts      # value types, operators, refs, literals, clauses, schedules
├── issues.ts     # WorkflowIssueCode + WorkflowIssue
├── schema.ts     # node/edge/definition schemas, format version, handle names, PRD caps
├── nodes.ts      # NODE_KINDS — what each node type declares about itself
├── normalize.ts  # readWorkflowVersion + the migrateDefinition seam
├── catalog.ts    # the WorkflowCatalog interface + createFixtureCatalog
└── validate.ts   # validateDefinition -> WorkflowIssue[]
```

Everything one node type does — handles, references, outputs, type checks, config checks — lives in
its single `NODE_KINDS` entry. `validate.ts` owns only the cross-cutting layers below; it never
switches on a node type.

## `validateDefinition`

Returns `WorkflowIssue[]`; **empty means activatable**. Checks run in layers, each assuming the
previous passed, so a customer is never shown type errors that are really a broken shape:

1. Shape — the document parses, no duplicate node ids.
2. Trigger — exactly one; either events or a schedule, never both; the schedule is coherent.
3. Edges — both endpoints exist, and the handle exists on the source node.
4. Graph — no cycle; every non-trigger step is reachable from the trigger.
5. References — every variable names a real, genuinely upstream value with a resolvable property path.
6. Types — required inputs supplied, types match, a `list<T>` never feeds a single-`T` input unless
   the action is in batch mode.
7. Configuration — every event/action/operation/entity id exists; nothing left half-configured.

Layers 5 and 6 deliberately **skip** a node whose catalog entry is missing (`configured()` on its
node kind), so an unknown action reports one `UNKNOWN_ACTION` rather than that plus a pile of
consequent input errors. A filter is always `configured` — a source that is not a list is a type
error the filter reports itself.

Two invariants worth knowing, both regression-tested: a reference must resolve to a **strict**
ancestor, which is what stops a node reading its own output and is why the output resolver needs no
re-entry guard; and a literal's `value` is checked against its declared `type` at parse time, since
every other check compares declared types only.

## The `workflowTriggerEvent` invariant (for phase 7)

A `workflowTriggerEvent` row exists **if and only if** the workflow is active, has a promoted
version, and that version's trigger nodes list that event id. Promoting a version, editing the
active version's trigger, and toggling `active` must all rewrite the workflow's rows —
delete-then-insert **in the same transaction** as the change. If these drift, a workflow silently
stops firing or fires when it should not.

## Validation Commands

```bash
pnpm --filter @carbon/workflows test              # vitest
pnpm --filter @carbon/workflows exec tsgo --noEmit # typecheck
pnpm exec biome check packages/workflows          # lint
```

Changing `Operator` in `@carbon/utils` also needs
`pnpm --filter @carbon/utils test` and `pnpm exec turbo run typecheck --filter=erp`.
