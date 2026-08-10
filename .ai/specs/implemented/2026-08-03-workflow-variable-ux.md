# Workflow variable UX rework

**Status:** implemented (code verified; browser pass still outstanding)
**Branch:** `feat/automation`

> The original spec, plan and three research files written earlier on 2026-08-03
> (`.ai/specs/2026-08-03-workflow-variable-ux.md`, `.ai/plans/2026-08-03-workflow-variable-ux.md`,
> `.ai/research/2026-08-03-variable-system-map.md`, `-workflow-node-config-map.md`,
> `-variable-ui-precedent.md`) were deleted from disk mid-session by something outside the
> implementation commands — every untracked file under `.ai/` went at once. This file is the
> record reconstructed after the fact, not the original design doc.

## What shipped

**One way to reach a variable.** Every value field now uses the same `{` trigger. The old
click-a-button-then-pick flow is gone: `fields/VariablePicker.tsx` and
`fields/VariablePickerButton.tsx` are deleted, and `control.ts`'s `needsPicker` with them.
Controls you cannot type a brace into (Select, Switch, record pickers, the list/entity
fallbacks) render `fields/VariableAffordance.tsx` — a `{}` button inside the control's own
border, so it costs no layout column. Text-entry controls (number, date) open the menu on `{`.

**One menu.** `fields/VariableTreeMenu.tsx` shows one level at a time: steps first, then that
step's outputs, then an entity's properties, capped at `MAX_PATH = 2` as before. Search cuts
across every level and keeps the full `Step › output › property` label on each row.
`fields/variableMenu.ts` gained `variableTree()` beside the existing `variableMenuItems()`,
which stays the flat search index. A level with one child and nothing to pick at it is
hoisted, so no one walks through an empty step.

**One keyboard implementation.** `fields/menuNav.ts` is a pure reducer — no React, no DOM —
covering ↑↓ (wrapping), Home/End, → to descend, ← to ascend (and unhandled at the root, so
the editor's caret still moves), Enter to select-or-descend, Escape to close, and Backspace
to pop a level in the popover only. 17 unit tests.

**Two hosts, no divergence.** `fields/InlineVariableMenu.tsx` mounts the menu in the tiptap
suggestion popup; `fields/VariableMenuPopover.tsx` mounts it in a Radix popover anchored to
the control. Both render the same component and route every key through the same reducer.
The tiptap popup lives outside the React tree, so `fields/useVariableMenuData.ts` bridges the
data through one module-level slot the focused editor publishes into.

**Layout.** The clause row stacks (property on its own line, operator and value beneath)
instead of three ~145px cells inside a 540px card. `MENTION_CHIP_CLASS` became `inline-block`
with `max-w-[14rem]` and `text-ellipsis` — `text-overflow` never applies to a flex
container's anonymous item, which is why long labels used to overflow into the line below —
plus `leading-5` and `py-0` so the chip sits inside the surrounding line box. Node card
bodies clip with `overflow-hidden`, and `BODY_TYPE` moved its controls to `text-sm` so one
row no longer mixes two font sizes.

**Growth and truncation.** `VariableText` takes `minRows` (default 1) and `maxRows`
(default 5, 10 on template/prose fields); past that it scrolls. Chips and inline tokens show
the value's leaf name with the full path on hover (`refLeafLabel` / `leafOfLabel` in
`tokenId.ts`, `renderTokenLabel` on `VariableText`, per-node `title` in the mention
`renderHTML`). The placeholder is finally visible — its CSS now ships with the component as
`packages/react/src/VariableText/variable-text.css`, because the app stylesheet that held it
(`apps/erp/app/styles/prosemirror.css`) is imported nowhere.

## Deviations from the plan

- **No `AutoGrowTextarea`.** Dropped during planning: the builder has no plain textarea, so
  it would have shipped with zero users.
- **`VariableMenu.tsx` → `VariableTreeMenu.tsx`.** The planned filename collides with
  `variableMenu.ts` on a case-insensitive filesystem; tsc rejects it outright.
- **The row-height style sits on a wrapper, not `EditorContent`.** `EditorContent` forwards
  unknown props to the editor rather than to its element — it has no `style` passthrough.
- **erp does not depend on `@carbon/tiptap`.** The menu-component types are re-exported from
  `@carbon/react/VariableText` as `VariableTextMenuComponent` / `-Props` / `-Handle` instead
  of adding a dependency.
- **Incompatible leaves stay visible and disabled** with the reason in their helper, as the
  old picker did. Only entity branches with nothing usable inside are pruned, so no one ever
  drills into a dead end.
- **`Now` and `The workflow's owner` are gone.** They were disabled placeholders; the
  definition format has no `now`/`owner` ref kind and the runtime has no resolution path, so
  making them work is an engine change, not a UI one.

## Verification

```
pnpm exec turbo run typecheck --filter=erp        # pass
pnpm --filter @carbon/react typecheck             # pass
pnpm --filter @carbon/tiptap typecheck            # pass
pnpm --filter @carbon/workflows typecheck         # pass
pnpm --filter @carbon/react test                  # 8 pass
cd apps/erp && npx vitest run app/modules/workflows   # 6 files, 75 tests pass
pnpm exec biome check <touched dirs>              # 0 errors, 1 pre-existing warning
pnpm lingui:extract && pnpm lingui:clean          # 15 new ids across 13 locales
```

**Not yet done:** the browser pass. The five regression guards to walk are an enum field
still showing its Select and publishing without `INCOMPLETE_CONFIG`; `PO#{` opening the menu
mid-word; Enter selecting from the menu; a `notify.message` holding one entity variable still
storing as a `template`; and `graph.test.ts` passing unchanged (it does).
