# Full-screen editor: locked title block + flush toolbar

## Scope
The two full-screen document editors only: **quality-document** (`QualityDocumentEditor.tsx`)
and **procedure** (inline `ProcedureEditor` in `procedure+/$id.tsx`). Everything else that
uses `@carbon/react/Editor` (notes, issue, chat, ~30 sites) must be **unchanged**.

## Goals (from the screenshot + request)
1. Remove padding so the formatting toolbar is **flush to the top and sides**.
2. Add **spacing between the toolbar and the content**.
3. **Move the title into the editor** as the locked first block, always an **H1**, and
   **sync it with the header title bar** — full-screen only.

## Approach — single editor, title = locked first H1 block
Plane uses two Yjs-bound editors; Carbon has no Yjs and stores `name`/`content` separately,
and we need the order **toolbar → title → body** (toolbar is the body editor's `slotBefore`).
A single editor whose node 0 is a locked H1 gives that order with the least surgery and
matches the request ("first block locked to be the title"). We borrow Plane's schema trick
(`Document.extend`) + Enter/Backspace keymap glue, in one editor.

**Backward-compatible data:** `content` stays title-free. The Editor composes the initial
doc as `[H1(title.value), ...initialValue.content]` and, on change, emits the **body without
node 0** back to `onChange` (unchanged `content` shape) plus the title text separately. No
migration; `name` and `content` keep their current storage.

### A. `packages/react/src/Editor/Editor.tsx` — opt-in `title` prop (default off)
```ts
title?: { value: string; onChange: (title: string) => void; placeholder?: string };
```
When set:
- Swap StarterKit's Document for `Document.extend({ content: "heading block+" })` and add a
  new **DocumentTitle** extension (below). When unset, extensions are exactly as today.
- Compose initial doc = `{ type:"doc", content:[ heading1(value), ...(initialValue?.content ?? [paragraph]) ] }`.
- `onUpdate`: split node 0 → `title.onChange(text)`; nodes 1.. → `onChange({type:"doc",content: rest})`.
- Apply content padding + toolbar→content gap **only in title mode** (see C).

### B. `packages/tiptap/src/extensions/document-title.ts` (new) — the lock
- Force node 0 heading `level = 1` (`appendTransaction`).
- Keymap: `Backspace` at doc start = no-op (can't delete/merge title); `Enter` in the title
  inserts a paragraph as node 1 and moves the cursor into it (Plane's behavior).
- Placeholder: title node → `title.placeholder ?? "Untitled"`; other empty nodes keep the
  existing "Press '/' for commands".
- Style hook: first-child H1 renders big (`text-3xl md:text-... font-semibold tracking-tight`)
  via `theme.css` (`.ProseMirror > h1:first-child`) so it reads like the old title.

### C. Flush toolbar + spacing
- Drop `p-6`/`gap-6` from the two editor wrappers → wrapper becomes `flex flex-col w-full h-full`.
  Toolbar (`sticky top-0 w-full ... p-2`) is then flush top + full-width.
- In title mode, pad the **ProseMirror content** (not the toolbar): add `px-6 pt-6` (or a
  `contentClassName`) so title+body have side gutters and a gap below the flush toolbar.

### D. Consumers (`QualityDocumentEditor.tsx`, inline `ProcedureEditor`)
- Delete the separate `<Input>` title.
- Pass `title={{ value: documentName, onChange: (t)=>{ setDocumentName(t); debouncedUpdateName(t); }, placeholder: t\`Untitled\` }}`.
- Keep content save (`updateContent` debounce) and name save (`updateName` fetcher) exactly as
  today — they just get fed from the split.
- Read-only (non-draft) fallback: render name as an `<h1>` above the `prose` body.

### E. Header live-sync ("sync with the title bar on top")
- Add a nanostore atom `documentTitleStore` (`~/stores`), set by the editor's `title.onChange`,
  read by `QualityDocumentHeader`/`ProcedureHeader` (prefer live value over `routeData.name`).
  Cleared/reset on id change. Persist + revalidate still go through `updateName` (source of truth).
- Reverse (header/form edits name → editor) already works via the route `key` re-seeding on
  revalidate; no extra wiring.

## Files
- `packages/react/src/Editor/Editor.tsx` (+ maybe `extensions.ts`)
- `packages/tiptap/src/extensions/document-title.ts` (new) + barrel
- `packages/config/tailwind/theme.css` (title first-child styling)
- `apps/erp/app/modules/quality/ui/Documents/QualityDocumentEditor.tsx`
- `apps/erp/app/routes/x+/procedure+/$id.tsx` (inline `ProcedureEditor`)
- `apps/erp/app/stores/*` (new title store) + `QualityDocumentHeader.tsx` + `ProcedureHeader.tsx`

## Risks
- Shared Editor contract — gated behind opt-in `title` prop; default path byte-identical. Verify
  notes/issue render unchanged.
- Enter/Backspace edge cases at the title↔body boundary.
- Title placeholder vs the existing heading placeholder must not collide.

## Verification
- `pnpm --filter @carbon/react typecheck`; scoped erp typecheck; biome.
- Browser: quality-document + procedure — locked H1 title, flush toolbar, gap, live header
  update, name+content persist; notes/issue unchanged.
