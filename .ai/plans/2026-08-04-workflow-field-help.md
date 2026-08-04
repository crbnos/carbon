# Workflow builder — field labels + glossary help tooltips

**Spec / source:** user description (below) + `.ai/research/2026-08-04-workflow-field-help-mapping.md`
**Branch:** `feat/automation`

## Problem

In the workflow builder's action/entity node config, the dynamic input fields have two defects:

1. **No labels on generated update actions.** `buildCatalog` emits
   `entity.<name>.<column>` labels but never `action.<name>.update.input.<column>`.
   `ActionForm.renderInput` looks up `actionInputLabelKey(actionId, name)`, misses, and
   falls back to the raw column name — so `customer.update` shows `accountManagerId`,
   `customerTypeId`, etc. instead of `Account manager`, `Customer type`. All 10 generated
   `<entity>.update` actions are affected; the 6 hand-written actions are fine.
2. **No help text anywhere.** Neither `ActionInputLike`, `BuiltActionInput` nor
   `CatalogInput` carries a description, and `fields/Field.tsx` renders a bare `<label>`.
   A user cannot tell what a field wants.

## Decided approach (confirmed with user)

Field help comes from **`@carbon/glossary`** term ids, rendered by the **existing
`LabelWithHelp`** ⓘ component from `@carbon/react` — the same help affordance every other
ERP form already uses. No new prose lives in the workflow catalog: an input declares
`help: "<term-id>"` and the definition text stays in the glossary, translated once.
Where a genuinely useful term does not exist yet, add it to the glossary so the rest of
the ERP gets it too.

Labels are fixed at the generator, not in the UI: `build.ts` learns to emit
`action.<entity>.update.input.<column>` from the same computation that already produces
`entity.<entity>.<column>`, extracted into one shared helper. The UI stays dumb.

## Progress

- [x] Task 1: Add `help` to the catalog authoring types
- [x] Task 2: Emit update-action input labels + a `help` map from `buildCatalog`
- [x] Task 3: Generate `help.generated.ts` and export it from `@carbon/workflows`
- [x] Task 4: Extend `check-workflow-catalog.ts` to catch a stale help map
- [x] Task 5: Add the new glossary terms
- [x] Task 6: Tag catalog inputs with glossary term ids
- [x] Task 7: Regenerate the catalog
- [x] Task 8: Render the ⓘ help in `fields/Field.tsx` and thread the prop through
- [x] Task 9: Wire `ActionForm` and `EntityForm` to look up help
- [x] Task 10: End-to-end verification

## Dependencies

Task 2 needs 1. Task 3 needs 2. Task 4 needs 3. Task 6 needs 1 and 5.
Task 7 needs 6 (and must run after any change to 1/2/3/6).
Task 8 needs 3. Task 9 needs 8. Task 10 needs everything.
Tasks 5 and 8 are independent of each other and may run in parallel.

## Global constraints

- **Never hand-edit** `*.generated.ts` under `packages/workflows/src/catalog/`. Task 7 is
  the only way they change.
- **Do not run `pnpm lingui:extract`.** On this branch it rewrites ~120k lines of stale
  `.po` churn. New `msg` strings are picked up at build time; leave the catalogs alone.
- Repo uses **pnpm** only, never npm.
- Whole-repo typecheck OOMs — always scope with `--filter`.

---

## Task 1: Add `help` to the catalog authoring types

**Depends on:** none
**Files:**
- Modify: `packages/workflows/src/catalog/actions.ts` — add `help?: TermId` to `ActionInputLike`
- Modify: `packages/workflows/src/catalog/build.ts` — add `help?: TermId` to `WritableColumnLike`
- Modify: `packages/workflows/package.json` — add `@carbon/glossary` to `devDependencies`
- Copy from (precedent): `packages/workflows/src/catalog/entities.ts:1` — the existing
  type-only cross-package import `import type { ColumnOf, TableName } from "@carbon/database/audit.config"`,
  where `@carbon/database` is a **devDependency**. `TermId` is used type-only the same way.

**Steps:**

1. In `packages/workflows/package.json`, add to `devDependencies` (keep keys alphabetical):
   ```json
   "@carbon/glossary": "workspace:*",
   ```
2. Run `pnpm install` from the repo root so the workspace link exists.
3. In `packages/workflows/src/catalog/actions.ts`, add the import at the top and the field:
   ```typescript
   import type { TermId } from "@carbon/glossary";
   ```
   ```typescript
   export interface ActionInputLike {
     type: ValueType;
     required: boolean;
     label: string;
     template?: boolean;
     /** Glossary term whose definition explains this field. Rendered as the ⓘ hover. */
     help?: TermId;
   }
   ```
   `ActionInputLike` is reused by `operations.ts` (`OperationDeclarationLike.inputs`), so
   operations get `help` from the same change — do not add a second field there.
4. **[amended 2026-08-04 during execution]** In `packages/workflows/src/catalog/build.ts`,
   also add `help?: TermId` to `RegistryEntry`. Reason: 25 of the 81 mapped fields are the
   *record* input — the "which record" picker on every `<entity>.update` action and the
   single input of every operation — and the plan originally gave those nowhere to be
   declared. Hand-tagging them would mean repeating one entity's term 25 times. One
   declaration per entity, reused wherever the entity itself is the field, is the
   single-source-of-truth answer:
   ```typescript
   export interface RegistryEntry {
     table: string;
     label: string;
     /** Glossary term for the entity itself. Reused for every field that IS this record. */
     help?: TermId;
     ...
   }
   ```
5. In `packages/workflows/src/catalog/build.ts`, add the same type-only import and extend
   **only** `WritableColumnLike` (writable columns become `<entity>.update` action inputs;
   watched columns are picked from a menu and have no labelled field, so they are out of
   scope):
   ```typescript
   export interface WritableColumnLike {
     label: string;
     /** Registry entity this column points at; needed only when the schema has no fk note. */
     ref?: string;
     /** Glossary term whose definition explains this field. Rendered as the ⓘ hover. */
     help?: TermId;
   }
   ```
5. Do **not** add `help` to `BuiltActionInput` or `CatalogInput`. The runtime catalog stays
   free of presentation data — that is the existing design (labels are stripped the same way).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/workflows
# Expected: "Tasks: 1 successful, 1 total" and no TS errors.
```

**Out of scope:** `WatchedColumnLike`, `BuiltActionInput`, `CatalogInput`, any change to
`actions.generated.ts` / `labels.generated.ts`.

---

## Task 2: Emit update-action input labels + a `help` map from `buildCatalog`

**Depends on:** Task 1
**Files:**
- Modify: `packages/workflows/src/catalog/build.ts` — extract a column-label helper, emit the
  missing labels, add `help` to `BuiltCatalog`

**Steps:**

1. Add `help` to `BuiltCatalog` (next to the existing `labels` field, ~line 466):
   ```typescript
   export interface BuiltCatalog {
     events: Record<string, BuiltEvent>;
     /** English label text per event, action and operation id; the generator wraps these in msg``. */
     labels: Record<string, string>;
     /** Glossary term id per input key, for the builder's ⓘ hover. Same key shape as `labels`. */
     help: Record<string, string>;
     entities: Record<string, Record<string, ValueType>>;
     enums: Record<string, Record<string, readonly string[]>>;
     actions: Record<string, BuiltAction>;
     operations: Record<string, BuiltOperation>;
   }
   ```
   Type it as `Record<string, string>` (not `TermId`) so the generic build stays decoupled;
   the emitted file re-types it as `TermId` in Task 3, which is where the compile-time check
   that matters actually lands.
2. Extract the existing column-label computation into a module-level helper, so the
   `entity.<name>.<column>` loop and the new update-input loop cannot drift apart. Place it
   next to the other helpers (near `humanizeColumn`):
   ```typescript
   /** One label per column, shared by `entity.<name>.<column>` and `<name>.update`'s inputs. */
   function columnLabel(entry: RegistryEntry, column: string): string {
     const rawLabel = entry.watch?.[column]?.label ?? entry.write?.[column]?.label;
     return rawLabel === undefined
       ? humanizeColumn(column)
       : rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);
   }
   ```
   Also extract the backtick guard, since it is now used from three places:
   ```typescript
   /** Labels are spliced into a `msg\`\`` template literal, so these would break the emit. */
   function assertLabelIsSafe(key: string, label: string): void {
     if (label.includes("`") || label.includes("${")) {
       throw new Error(
         `Label for ${key} contains a backtick or template literal: "${label}"`
       );
     }
   }
   ```
3. Rewrite the existing `entity.<name>.<column>` loop (currently ~lines 408-422) to use them:
   ```typescript
   for (const [column] of Object.entries(definition.properties)) {
     if (DROPPED_COLUMNS.has(column)) continue;
     const key = `entity.${name}.${column}`;
     const label = columnLabel(entry, column);
     assertLabelIsSafe(key, label);
     labels[key] = label;
   }
   ```
   The emitted values must be **byte-identical** to today's. If
   `pnpm run check:workflow-catalog` reports any changed `entity.*` label after this
   refactor, STOP and report — the extraction was not behaviour-preserving.
4. Inside the `if (writable.length > 0)` block (~lines 426-456), after `labels[id] = ...`,
   emit a label for every input of the generated update action:
   ```typescript
   // Without these the builder falls back to the raw column name (`accountManagerId`).
   labels[`action.${id}.input.${name}`] = entry.label;
   for (const [column, spec] of writable) {
     if (definition.properties[column] === undefined) continue;
     const key = `action.${id}.input.${column}`;
     const label = columnLabel(entry, column);
     assertLabelIsSafe(key, label);
     labels[key] = label;
     if (spec?.help !== undefined) help[`action.${id}.input.${column}`] = spec.help;
   }
   ```
   Note `name` here is the entity name (the loop variable), which is also the key of the
   record input — see `inputs[name] = { type: t.entity(name), required: true }` above it.
5. Declare `const help: Record<string, string> = {};` alongside the existing
   `const labels: Record<string, string> = {};` (~line 380), and return it:
   `return { events, labels, help, entities, enums, actions, operations };`
6. In the hand-written actions loop, inside the existing
   `for (const [input, spec] of Object.entries(declaration.inputs))` label loop, add:
   ```typescript
   if (spec.help !== undefined) help[`action.${id}.input.${input}`] = spec.help;
   ```
   and replace the inline backtick guard with `assertLabelIsSafe(...)`.
7. Do the same in the hand-written **operations** loop, keyed
   `operation.${id}.input.${input}`.
8. **[amended 2026-08-04 during execution]** Apply the entity-level `help` to the two places
   where the field IS the record. In the `writable.length > 0` block, next to the record
   input's label:
   ```typescript
   if (entry.help !== undefined) help[`action.${id}.input.${name}`] = entry.help;
   ```
   and in the operations loop, as a fallback under the per-input `help`:
   ```typescript
   // Every operation's one input is the entity record itself (see the `operation()`
   // helper), so it inherits that entity's term unless the input overrides it.
   else if (input === declaration.entity) {
     const entityHelp = registry[declaration.entity]?.help;
     if (entityHelp !== undefined) help[key] = entityHelp;
   }
   ```

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/workflows
# Expected: 1 successful, no TS errors.
pnpm --filter @carbon/workflows test
# Expected: all tests pass.
pnpm run check:workflow-catalog
# Expected: FAILS with "The committed catalog is out of date. ... has no label." naming
# action.<entity>.update.input.<column> keys. That failure is the proof this task worked;
# Task 7 clears it. If it fails for any OTHER reason — a changed entity.* label, a changed
# action/event/entity shape — STOP and report.
```

**Out of scope:** editing any `*.generated.ts` by hand; touching `WORKFLOW_EVENTS`,
`entities`, `enums`, or the `actions` record's shape.

---

## Task 3: Generate `help.generated.ts` and export it from `@carbon/workflows`

**Depends on:** Task 2
**Files:**
- Modify: `scripts/generate-workflow-catalog.ts` — emit the new file
- Modify: `packages/workflows/package.json` — add the `./help` export
- Copy from (precedent): the `labels`/`actions` emit blocks in the same script — same
  `HEADER`, same `sorted()`, same `fs.writeFileSync` shape.

**Steps:**

1. In `scripts/generate-workflow-catalog.ts`, after the `labels` const, add:
   ```typescript
   const help = [
     HEADER,
     `import type { TermId } from "@carbon/glossary";`,
     ``,
     `export const WORKFLOW_FIELD_HELP: Record<string, TermId> = ${JSON.stringify(sorted(built.help))};`,
     ``
   ].join("\n");
   ```
   A plain object, not a macro file — so unlike `labels.generated.ts` this one is safe to
   import from plain Node (which Task 4 relies on).
2. Add the write next to the others:
   ```typescript
   fs.writeFileSync(path.join(CATALOG_DIR, "help.generated.ts"), help);
   ```
3. Extend the closing `console.log` with `, ${Object.keys(built.help).length} help terms`.
4. Update the script's top doc comment: it currently says it builds three files; make it four.
5. In `packages/workflows/package.json`, add the subpath export next to `./labels`:
   ```json
   "./help": "./src/catalog/help.generated.ts"
   ```
   `@carbon/glossary` must be resolvable from consumers of this file. It is already a
   devDependency from Task 1 and the import is type-only, so nothing more is needed. If a
   consumer app fails to resolve `@carbon/glossary` from inside `@carbon/workflows`, STOP
   and report rather than moving the dependency.

**Verify:**
```bash
pnpm run generate:workflow-catalog
# Expected: prints "generate-workflow-catalog: N events, N entities, N actions, N operations,
# 0 help terms" (0 until Task 6 tags the inputs) and creates
# packages/workflows/src/catalog/help.generated.ts
pnpm exec turbo run typecheck --filter=@carbon/workflows
# Expected: 1 successful, no TS errors.
```

**Out of scope:** `check-workflow-catalog.ts` (Task 4), tagging any input (Task 6).

---

## Task 4: Extend `check-workflow-catalog.ts` to catch a stale help map

**Depends on:** Task 3
**Files:**
- Modify: `scripts/check-workflow-catalog.ts` — compare the committed help map to a rebuild

**Steps:**

1. Add the import next to the other generated-catalog imports:
   ```typescript
   import { WORKFLOW_FIELD_HELP } from "../packages/workflows/src/catalog/help.generated";
   ```
   Direct import is correct here: unlike `labels.generated.ts` this file has no `msg` macro,
   so plain Node can read it — no text-parsing workaround needed.
2. Inside the `if (failures.length === 0)` block, alongside the existing
   `assert.deepStrictEqual` blocks, add:
   ```typescript
   try {
     assert.deepStrictEqual(WORKFLOW_FIELD_HELP, rebuilt.help);
   } catch {
     fail(`${stale} A field's glossary help term changed.`);
   }
   ```

**Verify:**
```bash
pnpm run check:workflow-catalog
# Expected: "check-workflow-catalog: ok — ..." (Task 7 has not run yet, so if this still
# reports missing action.*.update.input.* labels, run Task 7 first and re-verify).
```

**Out of scope:** validating that a term id exists in the glossary — `TermId` is a
compile-time union, so typecheck already catches a typo at the declaration site.

---

## Task 5: Add the new glossary terms

**Depends on:** none (independent of Tasks 1-4; may run in parallel with them)
**Files:**
- Modify: `packages/glossary/src/terms.ts` — add the proposed entries
- Read first: `.ai/research/2026-08-04-workflow-field-help-mapping.md` — the
  "Proposed new glossary terms" section is the exact list to add
- Copy from (precedent): any existing entry in `packages/glossary/src/terms.ts` — match its
  shape exactly (`msg` descriptors for `term` and `definition`, optional `href`, optional
  `aliases`).

**Steps:**

1. Read the "Proposed new glossary terms" section of the research file. Add one entry per
   proposed slug, placed near topically-related existing entries rather than appended at the
   end.
2. Follow `packages/glossary/AGENTS.md` exactly:
   - `term` and `definition` are `msg` descriptors from `@lingui/core/macro`.
   - **One crisp sentence** per definition. Never multi-sentence.
   - Slugs are lowercase-hyphenated.
   - Do **not** add aliases to the `TermId` union.
3. Only add an `href` if you can point at a real heading in `docs/content/`. Omit it
   otherwise — a broken anchor is worse than no link.
4. If the research file proposes a term you cannot ground in real code/schema behaviour,
   drop it and mark that field NONE instead. Do not invent ERP semantics.

**Verify:**
```bash
pnpm --filter @carbon/glossary typecheck
# Expected: no TS errors.
pnpm --filter @carbon/glossary test
# Expected: all tests pass (terms.test.ts checks entry shape/slug invariants).
pnpm exec biome check packages/glossary/src/terms.ts
# Expected: "No fixes applied", no errors.
```

**Out of scope:** editing existing glossary entries' `term`/`definition`/`href`;
`packages/glossary/AGENTS.md` says ask first before changing an existing `href`.

---

## Task 6: Tag catalog inputs with glossary term ids

**Depends on:** Tasks 1 and 5
**Files:**
- Modify: `packages/workflows/src/catalog/actions.ts` — add `help:` to hand-written action inputs
- Modify: `packages/workflows/src/catalog/operations.ts` — add `help:` if the mapping calls for it
- Modify: `packages/workflows/src/catalog/entities.ts` — add `help:` inside `write:` blocks
- Read first: `.ai/research/2026-08-04-workflow-field-help-mapping.md`

**Steps:**

1. For every row in the research file's three mapping tables with a term id (not NONE), add
   `help: "<term-id>"` to that input's declaration. Example shape in `actions.ts`:
   ```typescript
   dueDate: { type: t.date, required: false, label: "due date", help: "job-deadline-type" },
   ```
   and in `entities.ts`:
   ```typescript
   write: {
     assignee: { label: "assignee", ref: "user", help: "customer-account-manager" }
   }
   ```
2. Leave every NONE row untagged. Do not invent a mapping the research file rejected —
   a wrong tooltip is worse than no tooltip.
3. `TermId` is a compile-time union of `keyof typeof terms`, so a typo or a term that
   Task 5 did not actually add is a type error, not a silent miss. Trust the typechecker
   over the research file: if a term id does not compile, the term was not added — go back
   to Task 5 or drop that mapping.
4. `operations.ts` builds every operation's single input through the shared `operation()`
   helper, so a per-operation `help` needs the helper to take an extra optional argument.
   Only do that if the research file maps operation inputs; otherwise leave `operations.ts`
   untouched.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=@carbon/workflows
# Expected: 1 successful, no TS errors. A "not assignable to type 'TermId'" error means a
# term id does not exist — fix the mapping, do not cast.
```

**Out of scope:** adding `help` to `watch:` blocks; changing any existing `label:` text.

---

## Task 7: Regenerate the catalog

**Depends on:** Task 6 (and re-run after any later change to Tasks 1, 2, 3 or 6)
**Files:**
- Modify (by generator only): `packages/workflows/src/catalog/labels.generated.ts`,
  `packages/workflows/src/catalog/help.generated.ts`

**Steps:**

1. From the repo root:
   ```bash
   pnpm run generate:workflow-catalog
   ```
   This also runs `biome check --write` over the catalog directory, so the emitted files
   come out formatted.
2. Inspect the diff. Expected changes and nothing else:
   - `labels.generated.ts` gains `action.<entity>.update.input.<column>` keys for all 10
     generated update actions, plus one `action.<entity>.update.input.<entity>` per action.
   - `help.generated.ts` is new/updated with the tagged term ids.
   - `actions.generated.ts` and `events.generated.ts` are **unchanged**. If either moved,
     STOP and report — Task 1 was supposed to keep presentation out of the runtime catalog.
3. Do **not** hand-edit the output.

**Verify:**
```bash
pnpm run check:workflow-catalog
# Expected: "check-workflow-catalog: ok — N events, N moments raised, N entities, N actions,
# N operations"
git diff --stat packages/workflows/src/catalog/
# Expected: only labels.generated.ts and help.generated.ts listed.
```

**Out of scope:** `pnpm lingui:extract` — see Global constraints.

---

## Task 8: Render the ⓘ help in `fields/Field.tsx` and thread the prop through

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/fields/Field.tsx` — render `LabelWithHelp`
- Modify: `apps/erp/app/modules/workflows/ui/Builder/fields/types.ts` — add `helpTermId` to `ValueFieldProps`
- Modify: `apps/erp/app/modules/workflows/ui/Builder/fields/ValueField.tsx` — pass it to both `<Field>` call sites (lines 42 and 66)
- Modify: `apps/erp/app/modules/workflows/ui/Builder/fields/TemplateField.tsx` — pass it to its `<Field>` (line 19)
- Copy from (precedent): `packages/form/src/components/SelectControlled.tsx:72` —
  `<LabelWithHelp termId={termId}>{label}</LabelWithHelp>` wrapping a label. That is the
  house pattern for every ERP form field.

**Steps:**

1. In `fields/Field.tsx`, add the import and prop:
   ```typescript
   import type { TermId } from "@carbon/glossary";
   import { cn, LabelWithHelp } from "@carbon/react";
   ```
   ```typescript
   /** Glossary term for the ⓘ hover. Absent => no icon, same layout. */
   helpTermId?: TermId;
   ```
2. Wrap the label contents. `LabelWithHelp` returns its children untouched when `termId`
   is `undefined`, so it is safe to wrap unconditionally — no branch needed:
   ```tsx
   <label
     className={cn(
       "text-sm font-medium text-foreground",
       hideLabel && "sr-only"
     )}
   >
     <LabelWithHelp termId={hideLabel ? undefined : helpTermId}>
       {label}
       {required && <span className="ml-0.5 text-destructive">*</span>}
     </LabelWithHelp>
   </label>
   ```
   `hideLabel ? undefined : helpTermId` because a `sr-only` label would hide the icon too —
   an invisible, unreachable help affordance is worse than none. (`ClauseRow.tsx` is the only
   `hideLabel` caller and passes no help, but the guard keeps that from becoming a trap.)
   `LabelWithHelp` defaults to `variant="stacked"`, which is built for exactly this
   label-above-a-control case and already compensates its own height so rows stay aligned.
3. In `fields/types.ts`, add to `ValueFieldProps`:
   ```typescript
   /** Glossary term for the ⓘ hover next to the label. */
   helpTermId?: TermId;
   ```
   with `import type { TermId } from "@carbon/glossary";` at the top.
4. In `ValueField.tsx`, destructure `helpTermId` from props and pass `helpTermId={helpTermId}`
   to **both** `<Field>` call sites (lines 42 and 66). Missing one silently drops the icon for
   half the control types.
5. Same in `TemplateField.tsx` for its single `<Field>`.
6. Do not touch `ClauseRow.tsx`.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: "Tasks: 1 successful, 1 total", no TS errors.
pnpm exec biome check apps/erp/app/modules/workflows/ui/Builder/fields/
# Expected: no errors.
```

**Out of scope:** `ClauseRow.tsx` (its labels are hard-coded column headings, not catalog
fields); any change to `LabelWithHelp` itself.

---

## Task 9: Wire `ActionForm` and `EntityForm` to look up help

**Depends on:** Task 8
**Files:**
- Modify: `apps/erp/app/modules/workflows/ui/Builder/catalog.ts` — add the lookup
- Modify: `apps/erp/app/modules/workflows/ui/Builder/config/forms/ActionForm.tsx` — `renderInput`, ~line 331
- Modify: `apps/erp/app/modules/workflows/ui/Builder/config/forms/EntityForm.tsx` — the inputs map, ~line 171

**Steps:**

1. In `catalog.ts`, next to `useWorkflowLabel`, add a plain function (not a hook — the map
   is static and has nothing to translate; the glossary text is translated inside
   `LabelWithHelp`):
   ```typescript
   import type { TermId } from "@carbon/glossary";
   import { WORKFLOW_FIELD_HELP } from "@carbon/workflows/help";

   /** Glossary term for a catalog input key, or undefined when the field has no help. */
   export function workflowFieldHelp(key: string): TermId | undefined {
     return WORKFLOW_FIELD_HELP[key];
   }
   ```
   Keyed exactly like labels, so `actionInputLabelKey` / `operationInputLabelKey` are reused
   verbatim — there is no second key format to keep in sync.
2. In `ActionForm.tsx`'s `renderInput`, next to the existing `inputLabel` line, add:
   ```typescript
   const inputHelp = workflowFieldHelp(actionInputLabelKey(actionId, name));
   ```
   and pass `helpTermId={inputHelp}` to both the `<TemplateField>` and the `<ValueField>`
   returns in that function.
3. In `EntityForm.tsx`, inside the `orderedInputNames.map(...)`, next to `inputLabel`, add:
   ```typescript
   const inputHelp = workflowFieldHelp(operationInputLabelKey(operationId, name));
   ```
   and pass `helpTermId={inputHelp}` to the `<ValueField>`.
4. Add `workflowFieldHelp` to the imports each file already pulls from `../../catalog` /
   `../catalog` — match the existing import path in each file rather than adding a new one.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: 1 successful, no TS errors.
cd apps/erp && npx vitest run app/modules/workflows
# Expected: all tests pass (83 currently).
```

**Out of scope:** `NotifyAboutField` in `ActionForm.tsx` (hand-rendered, not catalog-driven)
and the `requireOneOf` segmented toggle.

---

## Task 10: End-to-end verification

**Depends on:** all
**Files:** none

**Steps:**

1. Run the full gate from the repo root:
   ```bash
   pnpm run check:workflow-catalog
   pnpm exec turbo run typecheck --filter=@carbon/workflows
   pnpm exec turbo run typecheck --filter=erp
   pnpm --filter @carbon/glossary test
   pnpm --filter @carbon/workflows test
   pnpm exec biome check packages/workflows/src packages/glossary/src scripts apps/erp/app/modules/workflows
   ```
   Fix only **error**-severity biome findings; the repo carries ~419 pre-existing warnings.
2. Browser-check with the `/test` skill, but only with the user's permission. What to confirm:
   - Open a workflow, add an **Action** node, pick `Update a customer`. Every field shows a
     human label (`Account manager`, not `accountManagerId`).
   - A field tagged with a glossary term shows a ⓘ next to its label; hovering opens the
     definition, and the row height matches an untagged field beside it.
   - An untagged field shows no icon and no layout shift.
   - An **Entity** node's operation inputs behave the same way.
   - The condition/filter clause rows are visually unchanged (they pass `hideLabel`).
3. Report results with the actual command output. Do not claim done on any step not run.

**Verify:** the commands in step 1 all pass; the step-2 checks are observed, not assumed.

**Out of scope:** committing. Do not commit without an explicit request from the user.
