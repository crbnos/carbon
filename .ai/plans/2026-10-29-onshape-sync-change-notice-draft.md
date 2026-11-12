# Onshape BOM sync: never write a change notice's Draft or a locked revision

Bug fix. The sync connections' BOM sync can replace the BOM of a Draft that a change
notice holds. It also ignores release control. The path is the Onshape card in the BoM
Explorer: `OnshapeSync.tsx` → `api+/integrations.onshape.sync.ts` → `syncOnshapeMethod`
→ `syncMakeMethod`. It serves the `onshape` and `onshape-government` connections.

## Root cause

- `syncMakeMethod` (`items.service.ts`) looks up the Draft to reuse by item, status
  Draft and company, newest version first.
- A change notice's Draft is `max(version) + 1` (`createChangeNoticeDraftMethod`), so the
  lookup picks it. The sync then deletes the method's lines and writes new ones.
- The lookup exists twice: once for the top-level method and once for each
  sub-assembly.
- With no Active method, `activeMakeMethods` names the newest Draft, which can be a
  notice's. The sub-assembly path writes that Draft directly.
- The sync writes the method the caller names without a lock check.
  `syncOnshapeMethod` has no `checkRevisionLock`, so it writes a released (Production)
  revision under `enforce`.

## Pattern copied

The `onshape-v2` panel (`.claude/rules/onshape-panel.md`, Item and BOM writes):

- `loadMethodWriteRefusals` refuses a change notice's Draft, whatever the notice's stage.
- It refuses a released revision under `enforce` (`getLockVerdict`).
- The panel checks the refusals before it makes a Draft.
- `pickReusableDraft` never reuses a notice's Draft. The push takes a new version
  instead.
- The panel lists each refusal under `skipped` as `<part number>: <reason>`.

## Tasks

- [x] Move the per-method verdict of `loadMethodWriteRefusals` into the pure
      `methodWriteRefusal` (`items.service.ts`, beside `getLockVerdict`). The panel
      keeps the same verdict and the same messages.
- [x] In `syncMakeMethod`, read the methods it may write before the first write:
      `activeMakeMethods` for the BOM's items, the `changeOrderId` of their Drafts, the
      `revisionStatus` of the items and the top-level item. Call
      `loadMethodWriteRefusals` once.
- [x] If the top-level method is refused, throw a 422 `ServerFnError` with the part and
      the reason. The sync writes nothing. `syncOnshapeMethod` passes a refusal below
      500 through with its message (`postingFailure`).
- [x] If a sub-assembly is refused (`chooseSyncMethod`), write its line, pointed at its
      method. Do not delete or rewrite its BOM. Do not walk its subtree. Return it in
      `skipped`.
- [x] For an Active method (top level and sub-assembly), reuse the newest Draft that no
      change notice holds (`pickSyncDraft`). If there is none, make a new version
      `max(version) + 1` with the sync's existing code.
- [x] In `OnshapeSync.tsx`, show a warning toast that lists `skipped`. Keep the success
      toast for a sync with nothing skipped. Run the Lingui extract. Fill the
      translations.
- [x] Add tests for `methodWriteRefusal`, `chooseSyncMethod` and `pickSyncDraft` in
      `items.service.test.ts`.
- [x] Update the items `AGENTS.md`, `.claude/rules/onshape-panel.md` and
      `docs/content/docs/integrations/cad.mdx` (section "Import a bill of materials from
      Onshape").

## Verification

1. `pnpm --filter erp exec vitest run app/modules/items/items.service.test.ts`
2. `pnpm exec turbo run typecheck --filter=erp`
3. `pnpm exec biome check` on the changed files
4. `pnpm --filter @carbon/content test`

## Not in scope

- `getNextRevision` (`items.utils.ts`) does not advance labels like `A2` and overflows
  `ZZ`. The sync never calls it: a new item takes Onshape's revision, else `0`. So it
  does not interact with this fix.
- The sync still reuses a person's own Draft of an Active method when no notice holds
  it. The panel reuses only a Draft it made, by its marker row. This fix does not change
  that.
- For a sub-assembly with no row in `activeMakeMethods`, the sync reads any make method
  of the item, with no status or company filter. For an existing item with only
  Archived methods, it can write the Archived method.
