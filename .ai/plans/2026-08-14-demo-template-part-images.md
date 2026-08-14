# Demo template part images — implementation plan

**Spec / source:** user description, this session. Supersedes the earlier storage-bucket
design in this same file; that approach is dead and must not be revived.
**Branch:** `feat/onboarding-templates`

## The decision

The 132 part pictures are **vector SVGs committed to the repo**, one copy, living beside the
dataset data that names them. No Supabase storage, no bucket, no upload script, no
`_templates/` storage-permission exception, no build-time copy step. The bundler emits them
into each app's build the same way it emits any other imported asset.

`item.thumbnailPath` keeps holding a string. For seeded demo items that string is
`_templates/<industryId>/<readableId>.svg`, and `getPrivateUrl` resolves that one prefix to
the bundled asset instead of to the storage proxy. Every existing thumbnail call site is
fixed by that single function, and an unknown path resolves to `null` so the component falls
back to the grey icon it shows today.

Counts: 4 datasets x 33 items = **132**. NOTE: the generation prompts that produced the
current artwork were lost from `.ai/plans/assets/` and would have to be regenerated to
re-render or extend the set.

## Progress
- [x] Task 1: Move the 132 SVGs into the database package and delete the scratch output
- [x] Task 2: Add the `@carbon/database/dataset-assets` entry point
- [x] Task 3: Write `thumbnailPath` in `createItem`
- [x] Task 4: Resolve `_templates/` paths in both apps' `getPrivateUrl`
- [x] Task 5: Fail soft in both `ItemThumbnail` components
- [x] Task 6: Update `packages/database/src/datasets/AGENTS.md` and the onboarding rule
- [x] Task 7: Full verification

## Dependencies

Task 2 needs Task 1. Task 4 needs Task 2. Tasks 3 and 5 are independent of each other and of
Task 4. Task 6 needs Tasks 1 to 5. Task 7 is last.

---

## Task 1: Move the 132 SVGs into the database package and delete the scratch output

**Depends on:** none
**Files:**
- Create: `packages/database/src/datasets/assets/<industryId>/<readableId>.svg` (132 files)
- Delete: `.ai/plans/assets/svg/` (after the move), `.ai/plans/assets/images/`,
  `.ai/plans/assets/generate-images.mjs`

**Steps:**
1. Create the four target directories:
   ```bash
   cd /Users/aashu/work/carbon/carbon-feat-onboarding-templates
   mkdir -p packages/database/src/datasets/assets/{aerospace_satellite,robotics_oem,precision_manufacturing,automotive_precision}
   ```
2. Move only the four industry folders, not `samples/` and not `.preview/`:
   ```bash
   for d in aerospace_satellite robotics_oem precision_manufacturing automotive_precision; do
     mv .ai/plans/assets/svg/$d/*.svg packages/database/src/datasets/assets/$d/
   done
   ```
3. Delete the scratch output. `images/` holds 33 MB of PNGs rendered from these same SVGs
   and `generate-images.mjs` is a throwaway generator that reads `OPENAI_API_KEY` out of
   `.env`; neither belongs in the repo.
   ```bash
   rm -rf .ai/plans/assets/svg .ai/plans/assets/images .ai/plans/assets/generate-images.mjs
   ```
4. Confirm no SVG carries a `<script>` element or an `on*` handler. These are committed
   assets rendered through `<img>`, where scripts do not execute, but a generated file with
   script content in it should still not be committed:
   ```bash
   grep -rlE "<script|\bon[a-z]+=" packages/database/src/datasets/assets/ || echo "clean"
   ```
   If that prints any file path, STOP and report — do not strip it silently.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon-feat-onboarding-templates
find packages/database/src/datasets/assets -name '*.svg' | wc -l
# Expected: 132
ls .ai/plans/assets
# Expected: exactly one entry, demo-template-image-prompts.md
```

**Out of scope:** do not touch `.ai/plans/assets/demo-template-image-prompts.md`; do not
rename any SVG.

---

## Task 2: Add the `@carbon/database/dataset-assets` entry point

**Depends on:** Task 1
**Files:**
- Create: `packages/database/src/datasets/assets.ts`
- Modify: `packages/database/package.json` — add the `./dataset-assets` export and a `vite`
  devDependency
- Copy from (precedent): `apps/erp/app/modules/agent/agent.kb.ts:20` — the existing eager
  `import.meta.glob` usage in this repo

**Steps:**
1. Create `packages/database/src/datasets/assets.ts`. AS SHIPPED (the original sample used
   `/// <reference types="vite/client" />` and `import.meta.glob<string>`; see step 3 for why
   that was replaced by the inline cast):
   ```typescript
   // Demo-template part artwork, bundled rather than uploaded. See
   // .ai/plans/2026-08-14-demo-template-part-images.md.
   //
   // The cast stands in for `vite/client` types: declaring `ImportMeta.glob` here
   // collides with the real vite types in the apps, and a `vite` devDependency
   // resolves a second vite tree against this package's older @types/node. The call
   // expression stays literal, which is what vite's glob transform matches on.
   const assets = (
     import.meta as unknown as {
       glob(
         pattern: string,
         options: { eager: true; query: string; import: string }
       ): Record<string, string>;
     }
   ).glob("./assets/**/*.svg", {
     eager: true,
     query: "?url",
     import: "default"
   });

   export const TEMPLATE_ASSET_PREFIX = "_templates/";

   /**
    * Resolves `_templates/<industryId>/<readableId>.svg` to the bundled asset URL.
    * Returns null for any other path, and for a template path with no artwork, so the
    * caller can fall back instead of requesting a URL that does not exist.
    */
   export function getDatasetAssetUrl(path: string): string | null {
     if (!path.startsWith(TEMPLATE_ASSET_PREFIX)) return null;
     const rest = path.slice(TEMPLATE_ASSET_PREFIX.length);
     if (rest.includes("..")) return null;
     return assets[`./assets/${rest}`] ?? null;
   }
   ```
2. In `packages/database/package.json`, add to `exports`:
   `"./dataset-assets": "./src/datasets/assets.ts"`
3. DEVIATION, applied: no `vite` devDependency and no `/// <reference types="vite/client" />`.
   Both were tried first. `vite` in this package resolves against its older `@types/node`
   and installs a SECOND vite tree, churning `pnpm-lock.yaml` by ~500 lines; a local
   `declare global { interface ImportMeta { glob... } }` instead collides with the real
   vite types inside the apps (`TS2300: Duplicate identifier 'glob'` in `mes`). The shipped
   version casts `import.meta` inline, leaving the `import.meta.glob(...)` call expression
   itself untouched, which is what vite's compile-time transform matches on. Verified by
   build, not by reasoning: 129 SVGs emitted as files, the 3 under 4 KB inlined as data
   URIs by vite's default `assetsInlineLimit`, and `pnpm-lock.yaml` unchanged.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon-feat-onboarding-templates
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: succeeds, no error mentioning assets.ts or vite/client
```

**SSR safety, verified.** `path.ts` IS a server graph module (loaders and actions import it),
so this module is evaluated during SSR. That is safe because vite treats linked workspace
packages as non-external, so it BUNDLES `assets.ts` and transforms the glob at build time:
the literal asset map is present in both `apps/erp/build/server/index.js` and
`apps/mes/build/server/index.js`, and neither server bundle contains an unresolved
`dataset-assets` import or a runtime `import.meta.glob` call. Confirmed by grepping the built
output, not by reasoning. The fragility to know about: this relies on the package staying
non-external. Adding `@carbon/database` to `ssr.external` in either app would leave a bare
runtime import of a `.ts` file and crash the server on boot.

**Out of scope:** do not import this module from `seed-dev.ts`, the tiers, or
`@carbon/jobs`. Those run under plain Node/tsx with no bundler, so the glob is never
transformed and `import.meta.glob` is undefined at runtime.

---

## Task 3: Write `thumbnailPath` in `createItem`

**Depends on:** none
**Files:**
- Modify: `packages/database/src/datasets/helpers/items.ts` — set `thumbnailPath` on the
  `insertId(ctx, "item", {...})` call

**Steps:**
1. In `createItem`, inside the `insertId(ctx, "item", { ... })` object, add:
   ```typescript
   thumbnailPath: ctx.dataset.industryId
     ? `_templates/${ctx.dataset.industryId}/${spec.readableId}.svg`
     : null,
   ```
   `industryId` is `string | null` on `Dataset` (`packages/database/src/datasets/types.ts:756`);
   a dev-only dataset with no industry gets `null` and keeps today's icon.
2. Do NOT add a flag to `ItemSpec`. A path with no artwork resolves to `null` in Task 2 and
   the component falls back, so an opt-in flag would be a second source of truth for the
   same fact.
3. Leave the early-return branch for an already-existing item untouched — it does not insert.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon-feat-onboarding-templates
pnpm exec turbo run typecheck --filter=@carbon/database
# Expected: succeeds
grep -n 'thumbnailPath' packages/database/src/datasets/helpers/items.ts
# Expected: one match, inside the insertId call
```

**Out of scope:** do not backfill `thumbnailPath` for already-seeded companies, and do not
add a migration. This only affects newly seeded data.

---

## Task 4: Resolve `_templates/` paths in both apps' `getPrivateUrl`

**Depends on:** Task 2
**Files:**
- Modify: `apps/erp/app/utils/path.ts:2203` — `getPrivateUrl`
- Modify: `apps/mes/app/utils/path.ts:217` — `getPrivateUrl`

**Steps:**
1. In each file, add at the top of the import block:
   ```typescript
   import { getDatasetAssetUrl } from "@carbon/database/dataset-assets";
   ```
2. Replace the body of `getPrivateUrl` in each file with:
   ```typescript
   export const getPrivateUrl = (path: string) => {
     // Demo-template artwork ships with the app, so it never goes through the
     // storage proxy. Anything else is a real tenant file.
     return getDatasetAssetUrl(path) ?? `/file/preview/private/${path}`;
   };
   ```
   Doing it here rather than at each call site is deliberate: there are more than a dozen
   direct `getPrivateUrl(x.thumbnailPath)` callers across quotes, sales orders, purchase
   orders, supplier quotes, picking lists and kanban cards, and this fixes all of them at
   once.
3. Confirm `@carbon/database` is already a dependency of both apps. It is
   (`apps/erp/package.json` and `apps/mes/package.json` both list it), so no package.json
   change is needed here.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon-feat-onboarding-templates
pnpm exec turbo run typecheck --filter=erp --filter=mes
# Expected: both succeed. Note the erp app package is named `erp`, not `@carbon/erp`.
```

**Out of scope:** do not change `getStoragePath`, `getRawModelUrl`, or the
`apps/*/app/routes/file+/preview+/$bucket.$.tsx` routes. The storage authorization check
stays exactly as it is; nothing is being widened.

---

## Task 5: Fail soft in both `ItemThumbnail` components

**Depends on:** none
**Files:**
- Modify: `apps/erp/app/components/ItemThumbnail.tsx`
- Modify: `apps/mes/app/components/ItemThumbnail.tsx`

**Steps:**
1. In each component, add local state so a failed image load falls back to the existing icon
   branch rather than rendering a broken-image glyph:
   ```typescript
   const [failed, setFailed] = useState(false);
   ```
   Import `useState` from `"react"`.
2. Change the render condition from `thumbnailPath ? (` to
   `thumbnailPath && !failed ? (` and add `onError={() => setFailed(true)}` to the `<img>`.
3. Reset on a path change so a row reused by a virtualized table does not stay failed:
   give the `<img>` `key={thumbnailPath}` and keep the state keyed off it by declaring
   `const [failedPath, setFailedPath] = useState<string | null>(null);` instead of a boolean,
   setting `setFailedPath(thumbnailPath ?? null)` in `onError`, and testing
   `thumbnailPath && failedPath !== thumbnailPath`. Use this variant, not the boolean, in
   both files.
4. Keep both components' existing `cva` variants, sizes, icon colours and the MES
   `onClick`/`cursor-pointer` behaviour exactly as they are.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon-feat-onboarding-templates
pnpm exec turbo run typecheck --filter=erp --filter=mes
# Expected: both succeed
```

**Out of scope:** `apps/erp/app/components/ItemThumnailUpload.tsx` (note the misspelling in
the real filename) is the editor, not the display. It already handles a null path with a
"No image" placeholder and picks up the new behaviour through `getPrivateUrl` for free.

---

## Task 6: Update the docs that describe this

**Depends on:** Tasks 1 to 5
**Files:**
- Modify: `packages/database/src/datasets/AGENTS.md`
- Modify: `.claude/rules/onboarding-company-templates.md`

**Steps:**
1. In `packages/database/src/datasets/AGENTS.md`, under "Two layers, and the boundary
   matters", add a row or paragraph for `assets/<industryId>/<readableId>.svg`: part artwork,
   one SVG per item, shipped with the app and resolved by `@carbon/database/dataset-assets`.
   State that adding an item to a dataset means adding its SVG, and that a missing SVG
   degrades to the type icon rather than breaking.
2. In `.claude/rules/onboarding-company-templates.md`, add a short section stating that part
   thumbnails are bundled SVGs keyed on `industryId` and `readableId`, that
   `item.thumbnailPath` holds `_templates/<industryId>/<readableId>.svg` for seeded items,
   and that this path is NOT a storage object. Explicitly note that the
   `company-templates` bucket and `TEMPLATE_ASSET_PREFIX` in
   `packages/jobs/src/inngest/functions/tasks/company-backup.ts` remain dormant and are not
   part of this path, so a future reader does not connect them.
3. Do not edit `packages/database/supabase/backups/README.md`; its dormancy notes are still
   accurate.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon-feat-onboarding-templates
grep -n "assets/" packages/database/src/datasets/AGENTS.md
# Expected: at least one line describing the assets directory
```

**Out of scope:** no changes under `docs/` — this is internal, not customer-facing.

---

## Task 7: Full verification

**Depends on:** Tasks 1 to 6
**Files:** none

**Steps:**
1. Typecheck every package this touched.
2. Run Biome. Per the repo's standing note, fix only error-severity findings and leave the
   pre-existing warnings alone.
3. Run the database and workflows tests.
4. Build the ERP to prove the glob resolves and the SVGs are emitted as assets. If the build
   fails with the glob left untransformed, or the SSR bundle errors on
   `import.meta.glob`, add `"@carbon/database"` to `ssr.noExternal` in
   `apps/erp/vite.config.ts` and `apps/mes/vite.config.ts` and rebuild. If it still fails,
   STOP and report — do not improvise a different asset strategy.
5. Browser check, which needs the user's local stack running and a demo company seeded. Do
   not rebuild or reseed the database without asking. Confirm the parts list, an item detail
   page, a job, a quote line and a kanban card all show artwork in both light and dark mode,
   in the ERP and in MES.

**Verify:**
```bash
cd /Users/aashu/work/carbon/carbon-feat-onboarding-templates
pnpm exec turbo run typecheck --filter=@carbon/database --filter=@carbon/workflows --filter=@carbon/jobs --filter=erp --filter=mes
pnpm exec biome check
pnpm --filter @carbon/workflows exec vitest run src/seed-workflows.test.ts
pnpm exec turbo run build --filter=erp
pnpm exec turbo run build --filter=mes
```

**Evidence, as run:**

- typecheck, all five packages: `Tasks: 5 successful, 5 total`.
- `pnpm exec biome check`: `Found 399 warnings`, **zero errors**. All 399 are pre-existing
  (`lint/suspicious/noConsole` in the dev seed CLI and similar). One error DID appear and was
  fixed: an external formatter had added trailing commas throughout
  `packages/database/src/datasets/helpers/items.ts`, failing the repo format check;
  `biome check --write` on that one file restored repo style.
- `pnpm --filter @carbon/workflows exec vitest run src/seed-workflows.test.ts`:
  `Tests  30 passed (30)`.
- ERP build: succeeded, 129 SVGs emitted to `apps/erp/build/client/assets/`.
- MES build: succeeded, 129 SVGs emitted to `apps/mes/build/client/assets/`.
- The 132 minus 129 gap is not a failure: `MCH-END-CAP.svg`, `SEAL-ORING-224.svg` and
  `HW-DOWEL-8.svg` are each under 4 KB, so vite's default `assetsInlineLimit` inlined them
  into the lookup table as data URIs. All 132 resolve.
- Client-side cost, measured on `apps/erp/build/client/assets/path-DymyPk0E.js`: the glob map
  is 23.3 KB raw / ~5.0 KB gzipped, of which 13.1 KB is those 3 inlined SVGs. The other
  1.8 MB of artwork is fetched per-image on demand, never on page load.
- SSR: the transformed asset map is present in both apps' `build/server/index.js` (see Task 2).

**There is no `@carbon/database` test suite** — the package has no `test` script and no
`*.test.ts` files, so "run the database tests" is not a real step. The seed path's coverage is
`@carbon/workflows`' `seed-workflows.test.ts`, which is what ran above.

**NOT DONE — browser check.** Step 5 was never performed. It needs the user's local stack
running and a demo company seeded, and the repo rule forbids reseeding without asking. So
artwork has been proven to build, bundle and resolve, but has NOT been seen rendering in the
ERP or MES, in either light or dark mode. Treat that as open.

**Out of scope:** do not commit. Report and wait for an explicit instruction.
