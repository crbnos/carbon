# Thermo-nuclear review — workflow builder rounds 7 + inline `{variable}` tokens

Date: 2026-08-03 · Branch `feat/automation` · Uncommitted working tree (base `ffcf47ef1`)
Four independent reviewers: duplication/SSOT, structure, adversarial correctness, round-7 UI.

**Original verdict: do not ship** — five behaviour regressions, three of which meant the
headline feature did not work in its most common usage. **All findings now addressed;
verification at the bottom.**

## Blockers (fixed)

- **B1 — enum dropdowns replaced by a free-text box.** `ValueField` tested "is it text?"
  before `choices` reached `LiteralControl`, whose first rule is `choices → Select`. Every
  enum column is `primitive/string`, so status fields lost their dropdown and published as
  `INCOMPLETE_CONFIG`. Fixed structurally by `fields/control.ts` `pickControl` — one ordered
  decision where `choices` disqualifies the free-text rule by construction.
- **B2 — `{` did not open the menu mid-sentence.** `@tiptap/suggestion@2.27.2` defaults
  `allowedPrefixes: [" "]`, so `Hello {` worked and `PO#{` did not. `allowedPrefixes: null`
  is now threaded through `createMentionSuggestion`.
- **B3 — Enter could not select from the menu.** ProseMirror consults
  `editorProps.handleKeyDown` before plugins, so `VariableText` swallowing Enter for
  single-line mode also swallowed the popup's Enter. `createMentionSuggestion` gained
  `onActiveChange`; the host now stands down while the popup is open.
- **B4 — a lone variable collapsed to a bare ref and broke saved workflows.**
  `checkInputs` accepts any template for a text input but type-checks a bare ref, so a
  `notify.message` holding one entity variable started failing `TYPE_MISMATCH` — and an
  already-saved template was silently rewritten on any keystroke. `fromEditorParts` now
  takes `collapseSingleRef`, true only where the ref is type-checked. Covered by a test.
- **B5 — widened cards desynced from the layout constant.** `graph.ts` still hard-coded
  `NODE_WIDTH = 440` while cards grew to 540/500, so dropped nodes overlapped. Replaced by
  `MAX_NODE_CARD_WIDTH` from `nodes/kinds.ts`; `graph.test.ts` now derives its expectation
  instead of asserting `480`.

## Structural (fixed)

- **`ValueField` is control selection only.** `pickControl` (`inline` / `chip` / `literal`)
  plus `fields/Field.tsx` for the label / required / issue-or-hint shell, which deleted three
  hand-copies including `ClauseRow`'s degraded `Labelled`. The picker button now lives once in
  `fields/VariablePickerButton.tsx`.
- **`VariableText` is controlled.** It reconciles on content identity, ignoring labels. That
  deleted `mine`, `revision`, `key={revision}`, `signature()`, the lazy `live` mount and its
  static preview — and with them the caret-at-end bug and the chip/shell CSS copied across
  packages.
- **`walkPath` exported from `@carbon/workflows`**; the verbatim `walkType` copy in
  `VariablePicker` is gone.
- **One hop cap, one description helper.** `MAX_PATH` is exported from `variableMenu.ts` and
  consumed by the picker; `describeVariable` in `labelKeys.ts` replaced three copies of the
  "may be empty on this path" string and the incompatibility message.
- **One label builder.** `VariableChip` and `variableMenuItems` both call `refLabel`, so a
  reference reads identically as a chip and as an inline token. `buildLabel` deleted.
- **`canCollapse` enforced at the store.** `NODE_CAN_COLLAPSE` is checked in
  `setNodeExpanded`, so nothing writes `expanded: false` for a card that draws expanded.
- **`nodes/kinds.ts`** holds the macro-free per-kind facts (`NODE_CARD_WIDTH`,
  `NODE_CAN_COLLAPSE`) that layout and store code need. `meta.ts` reaches the translation
  catalog, which the unit-test runner cannot compile, so importing it from `graph.ts` broke
  `graph.test.ts`.

## Smaller (fixed)

`fieldPath` is required; lookup rows look up `match.N.field`, which is what the checker
actually emits; the edge button is back to `IconButton` with an `after:` hit area instead of
a hand-rolled 20px one; the literal NUL byte in `VariableText.tsx` (which made git treat the
file as binary, so it never diffed) is now `"\0"`; `Change variable` / `Pick a variable` and
the stray-brace hint are translated; `AGENTS.md` corrected.

## Deliberately not done

- **`ports.ts` keeps both `conditionPathLabel` and `conditionPortLabel`.** The "If" pill and
  the "Path 0" handle beside it are what was asked for, so the divergence is intended.
- **The stray-brace warning stays a field hint, not a `WorkflowIssue`.** `WorkflowIssue` has
  no severity — every issue is fatal — and a literal `{` in a message is legal, so promoting
  it would block publishing valid workflows.

## Verification

`typecheck` green for `erp`, `@carbon/react`, `@carbon/tiptap`, `@carbon/workflows`;
`biome check` clean but for the pre-existing `NodeCard.tsx:103` warning; 45 erp workflow
tests and 302 `@carbon/workflows` tests pass. **Not browser-verified.**

## Suspicions that did not pan out

`mention.tsx`'s `renderHTML` override is correct for 2.27.2 and round-trips `data-id`;
`StarterKit.configure({ bold, italic, strike, code: false })` uses real keys; the menu's
worst real case is 471 items built in ~0.33 ms into a virtualized list; `EMPTY_LEFT`
aliasing is harmless; `itemsRef.current = …` during render is the standard latest-ref
pattern; `toEditorParts`/`partsToDoc` is a genuine two-layer boundary, not duplication.
