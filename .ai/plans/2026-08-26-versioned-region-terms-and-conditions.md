# Versioned, Region-Aware Terms & Conditions — implementation plan

**Spec:** .ai/specs/2026-08-26-versioned-region-terms-and-conditions.md
**Research:** .ai/research/versioned-region-terms-and-conditions.md
**Branch:** po-company-eori (the workspace's active branch; plan originally mis-named it "cahokia" after the workspace)

## Progress
- [x] Task 1: Add the canonical COUNTRY_MAP to @carbon/utils and derive the existing profile helpers from it
- [x] Task 2: Add the pure terms-version resolver to @carbon/utils with unit tests
- [x] Task 3: Create the termsVersion migration with backfill and apply it (20260826121139_terms-versions.sql; applied via one-time `crbn up` — this worktree had no provisioned stack)
- [x] Task 4: Add zod validators to settings.models.ts
- [x] Task 5: Add termsVersion service functions + getEffectiveTerms to settings.service.ts (deviation: `getTerms` deleted here rather than Task 9 — same-typecheck window; also `datetime.today(companyTz)` used instead of the plan's `today(getLocalTimeZone())`, which the no-local-timezone check bans server-side)
- [x] Task 6: Add path constants and settings nav entry (paths named `termsVersions`/`termsVersion`/`newTermsVersion`/`deleteTermsVersion`; `path.to.legal.termsAndConditions` already existed)
- [x] Task 7: Build TermsVersionsTable and TermsVersionForm UI components (Country field deep-imported from `~/components/Form/Country` — it is not in the Form barrel)
- [x] Task 8: Add the four settings routes
- [x] Task 9: Rewire all document render call sites to getEffectiveTerms and delete the old readers (COUNTRY_MAP has 194 entries — the country seed's actual count, not >200)
- [x] Task 10: Full verification pass — erp/@carbon/utils/@carbon/documents typecheck green; 199 utils tests pass (11 resolver + 8 country new); full `pnpm run test` 25/25 tasks green; lint green (no warnings in new files). Docs synced: settings AGENTS.md + document-template-customizer.md. NOT committed (user asks for commits explicitly); browser verification not run (user preference: no browser unless asked)

## Dependencies
- Task 2 needs Task 1 (imports `groupsForCountry`). Tasks 1–2 are independent of Task 3.
- Task 4 needs Task 3 (generated types). Task 5 needs Tasks 2 + 4.
- Tasks 6–8 need Task 5. Task 9 needs Task 5. Tasks 8 and 9 are independent of each other.
- Task 10 last.

---

## Task 1: Add the canonical COUNTRY_MAP to @carbon/utils and derive the existing profile helpers from it

**Depends on:** none
**Files:**
- Modify: `packages/utils/src/country.ts` — add `COUNTRY_MAP`, `CountryGroupKey`, `groupsForCountry`, `countryGroupKeys`; reimplement `getCountryProfile` on top of the map; delete the standalone `COUNTRY_PROFILES` literal
- Copy from (precedent): the current `packages/utils/src/country.ts` (helper signatures stay identical)

**Steps:**
1. Read `packages/database/supabase/migrations/20240928155702_country-codes.sql` — its `INSERT INTO "country" ("name", "alpha2", "alpha3") VALUES ...` seed is the full ISO-3166 list. Generate one `COUNTRY_MAP` entry per row.
2. In `packages/utils/src/country.ts` define:
   ```typescript
   export type CountryGroupKey = "EU";

   type CountryFacts = {
     name: string;
     alpha3: string;
     groups?: readonly CountryGroupKey[];
     eori?: boolean;
     registrationNumber?: boolean;
   };

   export const COUNTRY_MAP: Record<string, CountryFacts> = { /* full ISO list */ };
   ```
   Flags to set, exactly reproducing today's behavior plus the EU group:
   - `groups: ["EU"]` AND `eori: true` on the EU-27: AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE
   - `eori: true, registrationNumber: true` on GB (GB is NOT in the EU group)
   - every other country: `name` + `alpha3` only
3. Reimplement with unchanged signatures (returned object shape for `getCountryProfile` must keep working for existing callers — they only read `.eori` / `.registrationNumber`):
   ```typescript
   export function getCountryProfile(countryCode: string | null | undefined) {
     if (!countryCode) return undefined;
     const entry = COUNTRY_MAP[countryCode.toUpperCase()];
     if (!entry || (!entry.eori && !entry.registrationNumber)) return undefined;
     return { eori: entry.eori, registrationNumber: entry.registrationNumber };
   }
   ```
   Keep `isEoriCountry` / `isRegistrationNumberCountry` as-is (they call `getCountryProfile`). Delete the old `COUNTRY_PROFILES` literal.
4. Add derived helpers:
   ```typescript
   export function groupsForCountry(countryCode: string | null | undefined): CountryGroupKey[] {
     if (!countryCode) return [];
     return [...(COUNTRY_MAP[countryCode.toUpperCase()]?.groups ?? [])];
   }

   export function countryGroupKeys(): CountryGroupKey[] {
     return ["EU"];
   }
   ```
5. Create `packages/utils/src/country.test.ts` (vitest, copy header style from `packages/utils/src/geo.test.ts`):
   - eori set derived from `COUNTRY_MAP` equals exactly the 28 codes listed in step 2 (EU-27 + GB)
   - registrationNumber set equals exactly `["GB"]`
   - `groupsForCountry("DE")` is `["EU"]`; `groupsForCountry("GB")` and `groupsForCountry("US")` are `[]`; `groupsForCountry("de")` is `["EU"]` (case-insensitive)
   - `COUNTRY_MAP` has exactly 194 entries (the `country` table seed's row count) and every entry has a non-empty `name` and 3-char `alpha3`
   - `isEoriCountry("FR") === true`, `isEoriCountry("US") === false` (behavior parity)

**Verify:**
```bash
pnpm --filter @carbon/utils test -- country
# Expected: country.test.ts passes, 0 failures
pnpm exec turbo run typecheck --filter=@carbon/utils --filter=@carbon/documents --filter=erp
# Expected: all three pass (documents + erp consume isEoriCountry)
```

**Out of scope:** do not touch `packages/documents/src/pdf/blocks/*/PartiesBlock.tsx` or the three tax forms that consume these helpers — signatures are unchanged so no caller changes.

## Task 2: Add the pure terms-version resolver to @carbon/utils with unit tests

**Depends on:** Task 1
**Files:**
- Create: `packages/utils/src/terms.ts`
- Create: `packages/utils/src/terms.test.ts`
- Modify: `packages/utils/src/index.ts` — add `export * from "./terms";` (alphabetical position)

**Steps:**
1. Implement the resolver exactly per the spec's algorithm (spec § "Resolution algorithm"):
   ```typescript
   import { groupsForCountry } from "./country";

   export type TermsVersionRow = {
     id: string;
     content: unknown; // tiptap JSONContent, untyped at this layer
     countryCode: string | null;
     countryGroup: string | null;
     effectiveFrom: string | null; // DATE string YYYY-MM-DD
     effectiveTo: string | null;
   };

   export function resolveEffectiveTermsVersion<T extends TermsVersionRow>(
     rows: T[],
     countryCode: string | null | undefined,
     date: string // YYYY-MM-DD
   ): T | null
   ```
   Logic (plain string comparison on YYYY-MM-DD, no Date objects — `.claude/rules/date-handling.md`):
   - `specificity(row)`: 2 if `row.countryCode` equals `countryCode` (case-insensitive); 1 if `row.countryGroup` is in `groupsForCountry(countryCode)`; 0 if both scope fields are null; otherwise −1 (scoped to somewhere else — never eligible).
   - Pass A (in-window): rows with specificity ≥ 0 AND (`effectiveFrom` null or ≤ date) AND (`effectiveTo` null or ≥ date). Pick highest specificity; tie-break latest `effectiveFrom` (null sorts oldest), then latest `id` for total order.
   - Pass B (quiet fallback 1): if Pass A empty — same but ignore `effectiveTo`.
   - Pass C (quiet fallback 2): if Pass B empty — same but ignore both date bounds.
   - Return `null` only when no row has specificity ≥ 0.
2. `terms.test.ts` covers, at minimum: country beats group beats global on the same date; DE resolves through EU group when no DE row exists; a row scoped to `US` is never returned for a DE supplier even when it is the only row (returns global or null); date window selects v1 on 2026-08-30 and v2 on 2026-09-01 given `effectiveTo 2026-08-31` / `effectiveFrom 2026-09-01`; expired-with-no-successor still returns the expired row (Pass B); future-only rows still resolve (Pass C); empty array returns null; null countryCode resolves global only.

**Verify:**
```bash
pnpm --filter @carbon/utils test -- terms
# Expected: terms.test.ts passes, 0 failures
```

**Out of scope:** no DB access, no supabase imports in this file — it must stay pure.

## Task 3: Create the termsVersion migration with backfill and apply it

**Depends on:** none
**Files:**
- Create: `packages/database/supabase/migrations/<timestamp>_terms-versions.sql` (via `pnpm db:migrate:new terms-versions` — never hand-pick the timestamp)

**Steps:**
1. `pnpm db:migrate:new terms-versions`
2. Write the SQL (conventions: `.claude/rules/conventions-database.md` — new-style RLS helpers, NOT the deprecated `has_role`/`has_company_permission` used by the old `terms` migration):
   ```sql
   CREATE TYPE "termsKind" AS ENUM ('Purchasing', 'Sales');

   CREATE TABLE "termsVersion" (
       "id" TEXT NOT NULL DEFAULT id('terms'),
       "companyId" TEXT NOT NULL,
       "kind" "termsKind" NOT NULL,
       "name" TEXT NOT NULL,
       "content" JSON NOT NULL DEFAULT '{}',
       "countryCode" TEXT REFERENCES "country"("alpha2") ON DELETE SET NULL ON UPDATE CASCADE,
       "countryGroup" TEXT,
       "effectiveFrom" DATE,
       "effectiveTo" DATE,
       "active" BOOLEAN NOT NULL DEFAULT TRUE,
       "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
       "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
       "updatedBy" TEXT REFERENCES "user"("id"),
       "updatedAt" TIMESTAMP WITH TIME ZONE,
       "customFields" JSONB,
       PRIMARY KEY ("id", "companyId"),
       FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
       CONSTRAINT "termsVersion_one_scope" CHECK (NOT ("countryCode" IS NOT NULL AND "countryGroup" IS NOT NULL)),
       CONSTRAINT "termsVersion_date_order" CHECK ("effectiveFrom" IS NULL OR "effectiveTo" IS NULL OR "effectiveFrom" <= "effectiveTo")
   );

   CREATE INDEX "termsVersion_companyId_idx" ON "termsVersion" ("companyId");
   CREATE INDEX "termsVersion_createdBy_idx" ON "termsVersion" ("createdBy");
   CREATE INDEX "termsVersion_updatedBy_idx" ON "termsVersion" ("updatedBy");
   CREATE INDEX "termsVersion_countryCode_idx" ON "termsVersion" ("countryCode");
   CREATE INDEX "termsVersion_lookup_idx" ON "termsVersion" ("companyId", "kind", "active");

   ALTER TABLE "public"."termsVersion" ENABLE ROW LEVEL SECURITY;

   CREATE POLICY "SELECT" ON "public"."termsVersion"
   FOR SELECT USING (
     "companyId" = ANY ((SELECT get_companies_with_employee_permission('purchasing_view'))::text[])
     OR "companyId" = ANY ((SELECT get_companies_with_employee_permission('sales_view'))::text[])
     OR "companyId" = ANY ((SELECT get_companies_with_employee_permission('settings_view'))::text[])
   );

   CREATE POLICY "INSERT" ON "public"."termsVersion"
   FOR INSERT WITH CHECK (
     "companyId" = ANY ((SELECT get_companies_with_employee_permission('settings_create'))::text[])
   );

   CREATE POLICY "UPDATE" ON "public"."termsVersion"
   FOR UPDATE USING (
     "companyId" = ANY ((SELECT get_companies_with_employee_permission('settings_update'))::text[])
   );

   CREATE POLICY "DELETE" ON "public"."termsVersion"
   FOR DELETE USING (
     "companyId" = ANY ((SELECT get_companies_with_employee_permission('settings_delete'))::text[])
   );

   -- Backfill: each company's existing terms become version 1 (global, open-ended).
   INSERT INTO "termsVersion" ("companyId", "kind", "name", "content", "createdBy")
   SELECT t."id", 'Purchasing'::"termsKind", 'Standard Terms', t."purchasingTerms", 'system'
   FROM "terms" t
   WHERE t."purchasingTerms" IS NOT NULL
     AND t."purchasingTerms"::text NOT IN ('{}', 'null', '""');

   INSERT INTO "termsVersion" ("companyId", "kind", "name", "content", "createdBy")
   SELECT t."id", 'Sales'::"termsKind", 'Standard Terms', t."salesTerms", 'system'
   FROM "terms" t
   WHERE t."salesTerms" IS NOT NULL
     AND t."salesTerms"::text NOT IN ('{}', 'null', '""');
   ```
   If the `system` user does not exist in the local DB (backfill fails on the `createdBy` FK), STOP and report — do not swap in another user id.
3. Apply: `pnpm db:migrate` (also regenerates DB types + swagger). Do NOT run any `db:build`.

**Verify:**
```bash
pnpm db:migrate
# Expected: migration applies cleanly, "types" regeneration runs
grep -n "termsVersion" packages/database/src/types.ts | head -3
# Expected: termsVersion Row/Insert/Update types present
```

**Out of scope:** do not modify or drop the existing `terms` table, its trigger, or its RLS. Do not touch `seed.data.ts`.

## Task 4: Add zod validators to settings.models.ts

**Depends on:** Task 3
**Files:**
- Modify: `apps/erp/app/modules/settings/settings.models.ts` — append validators
- Copy from (precedent): `itemSerialSequenceValidator` in the same file; `pricingRuleValidator` in `apps/erp/app/modules/sales/sales.models.ts` for the validFrom/validTo shape

**Steps:**
1. Add:
   ```typescript
   export const termsKinds = ["Purchasing", "Sales"] as const;

   export const termsVersionValidator = z
     .object({
       id: zfd.text(z.string().optional()),
       kind: z.enum(termsKinds, { errorMap: () => ({ message: "Kind is required" }) }),
       name: z.string().min(1, { message: "Name is required" }),
       content: zfd.text(z.string().optional()), // JSON-stringified tiptap doc from the hidden field
       scope: z.enum(["global", "country", "countryGroup"]),
       countryCode: zfd.text(z.string().optional()),
       countryGroup: zfd.text(z.enum(countryGroupKeys() as [string, ...string[]]).optional()),
       effectiveFrom: zfd.text(z.string().optional()),
       effectiveTo: zfd.text(z.string().optional()),
       active: zfd.checkbox({ trueValue: "true" }).optional(),
     })
     .refine((d) => d.scope !== "country" || !!d.countryCode, {
       message: "Select a country",
       path: ["countryCode"],
     })
     .refine((d) => d.scope !== "countryGroup" || !!d.countryGroup, {
       message: "Select a region",
       path: ["countryGroup"],
     })
     .refine(
       (d) => !d.effectiveFrom || !d.effectiveTo || d.effectiveFrom <= d.effectiveTo,
       { message: "Effective from must be on or before effective to", path: ["effectiveTo"] }
     );
   ```
   `countryGroupKeys` imports from `@carbon/utils`. Match the file's existing `zfd` usage style (read neighboring validators first and follow the file's exact `zfd.checkbox` convention).
2. In the route action (Task 8) the `scope` field maps to columns: `global` → both null; `country` → `countryCode` set, `countryGroup` null; `countryGroup` → inverse. Note this in a comment on the validator.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: passes
```

**Out of scope:** no changes to existing validators in the file.

## Task 5: Add termsVersion service functions + getEffectiveTerms to settings.service.ts

**Depends on:** Tasks 2, 4
**Files:**
- Modify: `apps/erp/app/modules/settings/settings.service.ts` — add five functions; delete `getTerms` (lines ~586-591) only in Task 9
- Copy from (precedent): `getItemSerialSequences` / `getItemSerialSequence` / `upsertItemSerialSequence` in the same file (list/get/upsert shape); the conventions in `.claude/rules/conventions-services.md`

**Steps:**
1. Add, following the exact house shape (client first, return `{data,error}`, never throw):
   - `getTermsVersions(client, companyId, args: GenericQueryFilters & { search: string | null })` — `.from("termsVersion").select("*", { count: "exact" }).eq("companyId", companyId)`; `ilike("name", ...)` on search; `setGenericQueryFilters(query, args, [{ column: "createdAt", ascending: false }])`.
   - `getTermsVersion(client, id, companyId)` — `.select("*").eq("id", id).eq("companyId", companyId).single()`.
   - `upsertTermsVersion(client, termsVersion)` — discriminated on `createdBy` (insert) vs `id + updatedBy` (update + `sanitize` + `updatedAt`), copying `upsertItemSerialSequence`'s style. `content` arrives as a JSON string; parse with `JSON.parse(content || "{}")` before writing.
   - `deleteTermsVersion(client, id, companyId)` — `.delete().eq("id", id).eq("companyId", companyId)`.
   - `getEffectiveTerms(client, args: { companyId: string; kind: "Purchasing" | "Sales"; countryCode: string | null; date: string | null })`:
     ```typescript
     const { data, error } = await client
       .from("termsVersion")
       .select("id, content, countryCode, countryGroup, effectiveFrom, effectiveTo")
       .eq("companyId", args.companyId)
       .eq("kind", args.kind)
       .eq("active", true);
     if (error) return { data: null, error };
     const resolved = resolveEffectiveTermsVersion(
       data ?? [],
       args.countryCode,
       args.date ?? today(getLocalTimeZone()).toString()
     );
     return { data: (resolved?.content ?? null) as JSONContent | null, error: null };
     ```
     `resolveEffectiveTermsVersion` imports from `@carbon/utils`; `today`/`getLocalTimeZone` from `@internationalized/date` (already used in this file — grep before importing).
2. Re-export any new types through the module barrel only if other modules need them (routes import from `~/modules/settings`).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: passes
```

**Out of scope:** do not remove `getTerms` yet (Task 9 does, atomically with its callers).

## Task 6: Add path constants and settings nav entry

**Depends on:** Task 5 (nominal — really only needs the route names)
**Files:**
- Modify: `apps/erp/app/utils/path.ts` — add next to `serialNumberSequences` (~line 1986): `termsAndConditions: ${x}/settings/terms-and-conditions`, `newTermsVersion`, `termsVersion: (id) => ...`, `deleteTermsVersion: (id) => ...`
- Modify: `apps/erp/app/modules/settings/ui/useSettingsSubmodules.tsx` — add to the **System** group (precedent: the Serial Numbers entry at ~lines 216-221): label `Terms & Conditions`, `to: path.to.termsAndConditions`, `role: "employee"`, icon `LuScale` (from `react-icons/lu`; if `LuScale` does not exist in the installed icon set, use `LuFileText`)

**Steps:**
1. Follow the exact naming/formatting of neighboring `path.to` entries (functions for id-parameterized paths).
2. Nav label goes through the same msg/Lingui wrapper the sibling entries use — copy the Serial Numbers entry precisely.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: passes
```

**Out of scope:** no other nav groups; no MES paths.

## Task 7: Build TermsVersionsTable and TermsVersionForm UI components

**Depends on:** Task 5
**Files:**
- Create: `apps/erp/app/modules/settings/ui/TermsAndConditions/TermsVersionsTable.tsx`
- Create: `apps/erp/app/modules/settings/ui/TermsAndConditions/TermsVersionForm.tsx`
- Create: `apps/erp/app/modules/settings/ui/TermsAndConditions/index.ts` (barrel: export both)
- Modify: `apps/erp/app/modules/settings/ui/index.ts` (or the module's ui barrel — read it first) — re-export the new folder
- Copy from (precedent): `apps/erp/app/modules/settings/ui/SerialNumbers/ItemSerialSequencesTable.tsx` and `ItemSerialSequenceForm.tsx` (table + drawer form skeleton); `apps/erp/app/modules/sales/ui/Pricing/PricingRuleForm.tsx` (DatePicker usage for validFrom/validTo, ~line 263); `apps/erp/app/components/DocumentTemplateEditor/BlockConfig.tsx` `TermsConfig` (~line 528, rich-text Editor wiring)

**Steps:**
1. **Table** (`memo` + `useMemo<ColumnDef>` like the serial-numbers table): columns —
   - name (Hyperlink to `path.to.termsVersion(id)`)
   - kind (badge; static filter options Purchasing/Sales)
   - scope: `countryCode` → country name via `COUNTRY_MAP[code]?.name ?? code`; `countryGroup` → the key; both null → "Global"
   - effectiveFrom / effectiveTo (render with the app's date formatter — grep the file's siblings for `formatDate` usage; "Always" when both null, copying `PricingRulesTable.tsx` ~line 77)
   - status badge computed from today vs the window: Active now / Scheduled (from > today) / Expired (to < today) / Inactive (`active === false`)
   - row actions: Edit (`LuPencil`) → `path.to.termsVersion(id)`, Delete (`LuTrash`) → `path.to.deleteTermsVersion(id)`, permission-gated with `usePermissions` exactly like the precedent
2. **Form** (Drawer + `ValidatedForm` with `termsVersionValidator`, `onClose = () => navigate(-1)`, `isEditing = initialValues.id !== undefined`):
   - `Select` for kind; `Input` for name
   - `Select` (or `RadioGroup` if the precedent forms use one — check `~/components/Form`) for scope with options Global / Country / Region; conditional render: scope `country` → `<Country name="countryCode" />` (existing `~/components/Form/Country`); scope `countryGroup` → `Select` with options from `countryGroupKeys()`
   - `<DatePicker name="effectiveFrom" />` and `<DatePicker name="effectiveTo" />` (PricingRuleForm precedent)
   - content: rich-text editor. First check `apps/erp/app/components/Form/RichText.tsx` — if it is a ValidatedForm-compatible rich-text field, use it with `name="content"`. Otherwise replicate the `TermsConfig` pattern: `Editor` from `@carbon/react/Editor` + `<Hidden name="content" value={JSON.stringify(doc)} />` updated `onChange`.
   - When `isEditing` and the initial window covers today, render the app's standard alert component (grep siblings for `Alert`) with: "This version is currently in effect. Issued documents will re-print with the new wording — consider creating a new version instead."
   - Submit gating identical to `ItemSerialSequenceForm.tsx` lines 68-70 (`permissions.can("update"|"create", "settings")`).
3. All user-facing strings via Lingui (`t` / `<Trans>`) matching the sibling components' import style.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: passes
```

**Out of scope:** no changes to the SerialNumbers components; no new shared components in `packages/react`.

## Task 8: Add the four settings routes

**Depends on:** Tasks 6, 7
**Files:**
- Create: `apps/erp/app/routes/x+/settings+/terms-and-conditions.tsx`
- Create: `apps/erp/app/routes/x+/settings+/terms-and-conditions.new.tsx`
- Create: `apps/erp/app/routes/x+/settings+/terms-and-conditions.$id.tsx`
- Create: `apps/erp/app/routes/x+/settings+/terms-and-conditions.delete.$id.tsx`
- Copy from (precedent): `apps/erp/app/routes/x+/settings+/serial-numbers.tsx`, `.new.tsx`, `.$id.tsx`, `.delete.$id.tsx` — copy each file's structure 1:1

**Steps:**
1. List route: `handle` breadcrumb `Terms & Conditions` → `path.to.termsAndConditions`; loader `requirePermissions(request, { view: "settings", role: "employee" })` + `getGenericQueryFilters` + `getTermsVersions`; render `<TermsVersionsTable data count />` + `<Outlet />` inside the same `VStack` wrapper the precedent uses.
2. New route: loader `create: "settings"`; action `assertIsPost` → `validator(termsVersionValidator).validate(formData)` → map `scope` to columns (`global`: both null; `country`: countryCode only; `countryGroup`: group only) → `upsertTermsVersion(client, { ...d, companyId, createdBy: userId })` → `redirect(path.to.termsAndConditions, await flash(request, success("Created terms version")))`; render `<TermsVersionForm initialValues={...empty}/>`.
3. Edit route: loader `view: "settings"` + `getTermsVersion` (404 → redirect with error flash like the precedent); action `update: "settings"` + same mapping + `upsertTermsVersion(client, { ...d, id, companyId, updatedBy: userId })`; initialValues derive `scope` from which column is set and `content` as `JSON.stringify(row.content)`.
4. Delete route: copy `serial-numbers.delete.$id.tsx` — loader `delete: "settings"` + fetch row for the confirm message; action calls `deleteTermsVersion`; renders the standard `ConfirmDelete` component.

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp
# Expected: passes
```

**Out of scope:** no changes to `serial-numbers*` routes; no `_layout` changes (flat routes pick the new files up automatically).

## Task 9: Rewire all document render call sites to getEffectiveTerms and delete the old readers

**Depends on:** Task 5
**Files:**
- Modify: `apps/erp/app/routes/file+/purchase-order+/$orderId[.]pdf.tsx` — replace `getPurchasingTerms(client, companyId)` (in the `Promise.all`, ~line 64) with a `getEffectiveTerms` call **after** the `Promise.all` (it needs `purchaseOrderLocations.data.supplierCountryCode` and `purchaseOrder.data.orderDate`): `{ kind: "Purchasing", countryCode: locations?.supplierCountryCode ?? null, date: purchaseOrder.data?.orderDate ?? null }`. Keep the existing error-logging/hard-fail behavior for the terms load. The prop stays `terms={(terms.data || {}) as JSONContent}`.
- Modify: `apps/erp/app/routes/file+/quote+/$id[.]pdf.tsx` (~line 186), `file+/sales-order+/$id[.]pdf.tsx` (~line 182), `file+/sales-invoice+/$id[.]pdf.tsx` (~line 224) — same pattern, `kind: "Sales"`, countryCode from that route's already-loaded customer-details/locations record (`customerCountryCode`), date: quote → `quote.data?.createdAt?.slice(0, 10) ?? null`; salesOrder → `orderDate`; salesInvoice → `dateIssued`.
- Modify: `apps/erp/app/routes/file+/shipment+/$id[.]pdf.tsx` — all four render paths (~lines 199, 322, 438, 551): `kind: "Sales"`; countryCode: use the customer country if that path already loads it, otherwise pass `null` (spec risk row allows global-terms interim — do NOT extend views in this task); date: `shipment.data?.createdAt?.slice(0, 10) ?? null`.
- Modify: `apps/erp/app/routes/share+/quote.$id.tsx` (~line 151, 227) — replace `getSalesTerms(serviceRole, ...)` with `getEffectiveTerms(serviceRole, { companyId, kind: "Sales", countryCode: <the quote's customerCountryCode if loaded in this route, else null>, date: quote.data?.createdAt?.slice(0, 10) ?? null })`; keep the downstream `generateHTML` flow unchanged (`terms` now `JSONContent | null` — guard `hasContent` the way the route already does for empty terms).
- Modify: `apps/erp/app/routes/x+/templates+/$type.tsx` (~lines 66, 73-87) — replace the `getTerms` call + `TERMS_FIELD` field indexing: keep the `TERMS_FIELD`-style map but map documentType → kind (`purchaseOrder` → `Purchasing`; `salesInvoice`/`salesOrder`/`quote`/`packingSlip` → `Sales`), then `termsSeed = (await getEffectiveTerms(client, { companyId, kind, countryCode: null, date: null })).data ?? undefined`.
- Modify: `apps/erp/app/modules/settings/documentPreview.server.ts` (~lines 173, 199, 223, 269) — replace each `getSalesTerms`/`getPurchasingTerms` with `getEffectiveTerms` (`countryCode: null, date: null`).
- Modify: `apps/erp/app/modules/purchasing/purchasing.service.ts` — delete `getPurchasingTerms` (~lines 494-503)
- Modify: `apps/erp/app/modules/sales/sales.service.ts` — delete `getSalesTerms` (~lines 1711-1716)
- Modify: `apps/erp/app/modules/settings/settings.service.ts` — delete `getTerms` (~lines 586-591)

**Steps:**
1. Rewire the 7 consumer files first, importing `getEffectiveTerms` from `~/modules/settings` (add to the barrel if not exported).
2. Then delete the three old readers and fix any barrel re-exports of them (`grep -rn "getPurchasingTerms\|getSalesTerms\|getTerms\b" apps packages` must return zero app-code hits afterward, excluding this plan/spec).
3. If any route turns out not to have the counterparty country already loaded, pass `countryCode: null` — do not add new view columns or extra queries beyond the one `getEffectiveTerms` call. If `orderDate`/`dateIssued` is not on the already-loaded record, STOP and report rather than adding a new query.

**Verify:**
```bash
grep -rn "getPurchasingTerms\|getSalesTerms" apps packages --include="*.ts*" | grep -v ".ai/"
# Expected: no output
pnpm exec turbo run typecheck --filter=erp
# Expected: passes
```

**Out of scope:** `packages/documents/**` — zero changes (the `terms` prop contract is unchanged). The `terms` DB table and its trigger stay.

## Task 10: Full verification pass

**Depends on:** all
**Files:** none (verification only)

**Steps:**
1. `pnpm exec turbo run typecheck --filter=erp --filter=@carbon/utils --filter=@carbon/documents`
2. `pnpm --filter @carbon/utils test`
3. `pnpm run lint` (fix any new-file violations)
4. Confirm every spec acceptance criterion has its mechanism in place; list any that need browser verification and note that `/test` browser verification is available **only with the user's explicit OK** (user preference: no browser automation unprompted).

**Verify:**
```bash
pnpm exec turbo run typecheck --filter=erp --filter=@carbon/utils --filter=@carbon/documents && pnpm --filter @carbon/utils test && pnpm run lint
# Expected: all green, 0 errors
```

**Out of scope:** committing — commits only via /check-and-commit and only when the user asks.
