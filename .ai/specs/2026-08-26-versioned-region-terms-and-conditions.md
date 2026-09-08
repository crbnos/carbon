# Versioned, Region-Aware Terms & Conditions for Outgoing Documents

> Status: draft
> Author: naveen (design interview) + Claude (spec)
> Date: 2026-08-26
> Research: `.ai/research/versioned-region-terms-and-conditions.md`

## TLDR

Replace the single company-wide T&C blob with **versioned, effective-dated terms records** that can be scoped to a country or a built-in region group (e.g. `EU`) derived from a new canonical base country map in `@carbon/utils` — the single place country facts live, which the existing `COUNTRY_PROFILES` helpers are refactored to read from too. At render time each outgoing document (PO, quote, sales order, invoice, packing slip/shipment) resolves the applicable version from the counterparty's country and the document's issue date — most specific match wins, quiet fallback when no version is in effect. Existing terms migrate as "version 1" (global, open-ended); no PDF-layer code changes — the resolver feeds the existing `terms` fallback prop. No surveyed competitor (SAP, NetSuite, Coupa, Oracle Fusion, Odoo, D365) has effective-dated terms; this closes the evidentiary gap they all leave to manual process.

## Problem Statement

The compliance requirement (supplier-quality checklist): *"Current T&Cs are provided with every purchase order, printed on the back or final page, suitable for region, updated as they change; ideally T&Cs have from/to dates so each outgoing supplier document has the relevant version attached."*

Carbon today:

- ✅ T&Cs print on the final page of every PO/quote/SO/invoice via the built-in `terms` block (`packages/documents/src/pdf/blocks/*/TermsBlock.tsx`, forced page break, renders nothing when empty).
- ❌ One T&C body per company per document type — `documentTemplate` is `UNIQUE ("companyId", "documentType")` and the `terms` table (`20240908100622_terms.sql`) is one row per company with `purchasingTerms`/`salesTerms` JSON. A company buying from US and EU suppliers cannot send jurisdiction-appropriate terms.
- ❌ No effective dating, no history: `terms` has only `updatedAt`/`updatedBy`. A planned terms change (e.g. "new terms from Oct 1") requires someone to remember to paste it in on the day, and there is no record of which wording was live when a given PO went out.
- ❌ The company-level `terms` table has no settings UI at all — the only edit surface is the per-document-type template editor.
- Pre-existing wrinkle: the public shared-quote page (`share+/quote.$id.tsx:227`) reads the company `terms` table directly while the quote PDF reads the template block with the table as fallback — the two can diverge.

## Proposed Solution

One new company-scoped table — `termsVersion` — plus a canonical base country map in `@carbon/utils` (from which group membership and the existing country profiles are derived), one resolver function, a Settings page, and a data migration. The document-template `terms` block and all PDF rendering code are **untouched**: routes already pass a `terms` fallback prop; the resolver simply changes what that prop contains.

### Resolution algorithm (`getEffectiveTerms`)

Inputs: `companyId`, `kind` (`Purchasing` | `Sales`), `countryCode` (counterparty's alpha-2, nullable), `date` (the document's issue date).

1. Load all `active` rows for (`companyId`, `kind`) — one query; rank in JS (the `pricingRule` pattern, `sales.service.ts:2202`).
2. Filter to rows **effective at `date`**: `effectiveFrom` null-or ≤ date AND `effectiveTo` null-or ≥ date.
3. Pick by **specificity ladder** (the `customerItemPriceOverride` pattern, `sales.service.ts:2477`):
   `countryCode` listed in the row's `countryCodes` → a `countryGroup` that `groupsForCountry(countryCode)` reports membership in → global (no scope).
4. Within a tier, latest `effectiveFrom` wins (null sorts oldest).
5. **Quiet fallback** (user decision): if step 2 leaves nothing (a dating gap), re-run steps 3–4 ignoring `effectiveTo` (latest version whose `effectiveFrom` ≤ date); if still nothing, latest version of any date; if the table is empty, return null — the terms block then falls back to authored template-block content or renders nothing. Printing is **never** blocked.

### What "date" means per document

Resolution uses the document's own issue date so reprints are deterministic (Carbon documents are live renders — same reason the supplier address is a live join):

| Document | Date column | Country source (already on the loaded view) |
|---|---|---|
| Purchase order | `purchaseOrder.orderDate` | `purchaseOrderLocations.supplierCountryCode` |
| Quote (PDF + share page) | `quote.createdAt` (date part; quotes have no issue-date column) | `quoteCustomerDetails.customerCountryCode` |
| Sales order | `salesOrder.orderDate` | `salesOrderLocations.customerCountryCode` |
| Sales invoice | `salesInvoice.dateIssued` | `salesInvoiceLocations.customerCountryCode` |
| Shipment / packing slip | `shipment.createdAt` (date part) | customer country from the shipment's loaded customer location (verify during implementation; extend the view if absent) |

Null date column → today. Date comparison is plain DATE-string comparison — no JS `Date` arithmetic (`.claude/rules/date-handling.md`).

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Region granularity | Country (ISO alpha-2, FK to existing global `country` table) **or** a built-in region group key; a country resolves through its group when no country-specific version exists | User decision (revised 2026-08-26): no user-managed group entity — group membership is code, not data |
| Country group shape | A **canonical base country map** in `packages/utils/src/country.ts`: `COUNTRY_MAP: Record<alpha2, { name: string; groups?: readonly CountryGroupKey[]; eori?: boolean; registrationNumber?: boolean }>` covering the full ISO-3166 list. Group membership (`groupsForCountry(alpha2)`, group keys for the UI) is **derived** from it, and the existing `COUNTRY_PROFILES` helpers (`getCountryProfile`, `isEoriCountry`, `isRegistrationNumberCountry` — signatures unchanged) are refactored to read from the same map. V1 ships one group key, `EU` (the 27 members flagged in the map). No country list is ever written twice | User decision (second revision): one source of truth for country facts; membership like "DE is in the EU" is world knowledge, not tenant config — kills a table, four routes, and a form |
| Specificity conflict | Country beats group beats global; within a tier latest `effectiveFrom` wins; overlapping same-tier rows are legal | `customerItemPriceOverride` ladder precedent; no SAP-style priority integers to explain |
| Scope of documents | **Both purchasing and sales** kinds in one table (`kind` enum) | User delegated; the render machinery is already identical for both sides (shared `resolveTerms`), so purchasing-only would split one mechanism in two |
| Admin UI location | New **Settings → Terms & Conditions** page (list + drawer form, `serial-numbers` route pattern) | User delegated; the template editor is per-document-type and per-company — wrong altitude for cross-document versioned records. Settings module already holds the `terms` RLS (`settings_update`) |
| Template `terms` block precedence | **Unchanged**: authored block content still wins over the resolved version (`resolveTerms` untouched) | AGENTS.md "preserve behavior"; the block is an explicit per-document-type override. The block editor's seed becomes the currently-effective global version, and `TermsConfig` gets a hint that authored content bypasses region/date selection |
| Existing data | Migration inserts each company's non-empty `purchasingTerms`/`salesTerms` as a global, open-ended version named "Standard Terms"; the `terms` table stays in place but is no longer read (dropped in a later cleanup migration) | User decision ("existing stays the same and becomes version 1"); keeping the table avoids touching its trigger/RLS in the same change |
| Gap behavior | Quiet fallback down the ladder; never block or warn at print time | User decision |
| Resolution date | Document issue date, not print date | Deterministic reprints ≈ the audit answer competitors get from output archiving; a PO reprinted next year shows the terms that applied when it was issued (as long as versions aren't edited — see Risks) |
| Version mutability | Rows are editable; the form shows a warning when editing a version currently in effect ("issued documents will re-print with the new wording — create a new version instead") | Carbon documents are live renders throughout (supplier address is a live join); hard immutability + version stamping on documents is the natural v2, out of scope here |
| Merge fields in versioned terms | **Supported** (revised post-implementation): `resolveTerms` now interpolates the fallback path too, and the shared quote page interpolates with `buildQuoteVars`. The version editor offers an "Insert field" menu — full PO field set for Purchasing; the customer/company intersection for Sales (a Sales version prints on four document types, and an unknown token prints blank) | User request; interpolation is one shared function so all five document types behave identically |
| Multi-tenancy (heuristic 1) | Both tables: `companyId`, composite PK `("id","companyId")`, `id('prefix')` defaults, audit columns | House convention; `country` FK is global reference data (no `companyId`), like `address.countryCode` |
| Service shape (heuristic 2) | All functions in `settings.service.ts`, `client` first, return `{data, error}`, never throw | House convention; settings module owns the admin surface, consumed cross-module by the PDF routes like `getTerms` is today |
| RLS (heuristic 3) | SELECT: `purchasing_view` OR `sales_view` OR `settings_view`; INSERT/UPDATE/DELETE: `settings_*` — mirroring the `terms` table's policies (`20240908100622_terms.sql:36-51`) | PDF routes authenticate with `view: "purchasing"` / `view: "sales"` and must read terms; only settings admins write |
| Permissions (heuristic 4) | Settings routes use `requirePermissions(request, { view/create/update/delete: "settings", role: "employee" })`; PDF routes unchanged | `.ai/lessons.md`: no new permission family for a feature that fits an existing domain |
| Forms (heuristic 5) | `ValidatedForm` + `validator(zodSchema)` from `@carbon/form`; rich text via `Editor` from `@carbon/react/Editor` with a hidden JSON field (the `TermsConfig` pattern, `BlockConfig.tsx:528`) | House convention |
| Module layout (heuristic 6) | Validators in `settings.models.ts`, services in `settings.service.ts`, UI under `modules/settings/ui/TermsAndConditions/`, barrel export | One models/service file per module |
| Backward compatibility (heuristic 7) | No frozen surface touched. `PurchaseOrderPDF`'s required `terms` prop keeps its type (`JSONContent`); only what routes pass into it changes. `getPurchasingTerms`/`getSalesTerms` are replaced by `getEffectiveTerms` at all 11 call sites and deleted | The PDF package needs zero changes — smallest possible blast radius |

## Data Model Changes

New migration (`pnpm db:migrate:new terms-versions`), then `pnpm run generate:types`.

```sql
CREATE TYPE "termsKind" AS ENUM ('Purchasing', 'Sales');

CREATE TABLE "termsVersion" (
    "id" TEXT NOT NULL DEFAULT id('terms'),
    "companyId" TEXT NOT NULL,
    "kind" "termsKind" NOT NULL,
    "name" TEXT NOT NULL,                             -- e.g. "EU Purchasing Terms — 2026 revision"
    "content" JSON NOT NULL DEFAULT '{}',             -- tiptap JSONContent
    "countryCodes" TEXT[] NOT NULL DEFAULT '{}',      -- alpha-2 codes; empty = not country-scoped (pricingRule array precedent, no FK)
    "countryGroup" TEXT,                              -- group key derived from the base country map (@carbon/utils), e.g. 'EU'; validated by zod, no FK
    "effectiveFrom" DATE,                             -- NULL = since forever
    "effectiveTo" DATE,                               -- NULL = open-ended
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL REFERENCES "user"("id"),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    "updatedBy" TEXT REFERENCES "user"("id"),
    "updatedAt" TIMESTAMP WITH TIME ZONE,
    "customFields" JSONB,
    CONSTRAINT "termsVersion_pkey" PRIMARY KEY ("id", "companyId"),
    CONSTRAINT "termsVersion_companyId_fkey" FOREIGN KEY ("companyId")
        REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "termsVersion_one_scope" CHECK (NOT (cardinality("countryCodes") > 0 AND "countryGroup" IS NOT NULL)),
    CONSTRAINT "termsVersion_date_order" CHECK ("effectiveFrom" IS NULL OR "effectiveTo" IS NULL OR "effectiveFrom" <= "effectiveTo")
);

CREATE INDEX "termsVersion_lookup_idx" ON "termsVersion" ("companyId", "kind", "active");

-- RLS: mirror the "terms" table policies (20240908100622_terms.sql):
--   SELECT  → purchasing_view OR sales_view OR settings_view
--   INSERT/UPDATE/DELETE → settings_create / settings_update / settings_delete
ALTER TABLE "termsVersion" ENABLE ROW LEVEL SECURITY;
-- (policy bodies follow the current conventions in .claude/rules/conventions-database.md)

-- Backfill: each company's existing terms become version 1 (global, open-ended).
INSERT INTO "termsVersion" ("companyId", "kind", "name", "content", "createdBy")
SELECT t."id", 'Purchasing', 'Standard Terms', t."purchasingTerms", 'system'
FROM "terms" t
WHERE t."purchasingTerms" IS NOT NULL
  AND t."purchasingTerms"::text NOT IN ('{}', 'null');
-- (same INSERT for 'Sales' / "salesTerms")
```

The `terms` table remains (trigger still creates rows for new companies) but nothing reads it after this change; a follow-up cleanup migration drops it once the release has settled.

## API / Service Changes

All in `apps/erp/app/modules/settings/settings.service.ts` (+ validators in `settings.models.ts`):

- `getTermsVersions(client, companyId, args)` — list for the settings table (GenericQueryFilters).
- `getTermsVersion(client, id, companyId)` — single row for the edit drawer.
- `upsertTermsVersion(client, data)` / `deleteTermsVersion(client, id, companyId)`.
- **`getEffectiveTerms(client, { companyId, kind, countryCode, date })`** — the resolver (algorithm above). One `.select()` scoped by `companyId` + `kind` + `active`, ranking in TypeScript; group membership checked via `groupsForCountry(countryCode)` from `@carbon/utils`. Returns `{ data: JSONContent | null, error }`.

In `packages/utils/src/country.ts`: add the canonical `COUNTRY_MAP` (full ISO-3166, keyed by alpha-2, each entry carrying `name` plus optional facts: `groups`, `eori`, `registrationNumber`), with derived helpers `groupsForCountry(alpha2)` and `countryGroupKeys()`. Refactor the existing `COUNTRY_PROFILES` consumers (`getCountryProfile` / `isEoriCountry` / `isRegistrationNumberCountry`) to read from `COUNTRY_MAP` with unchanged signatures and unchanged answers for every country — verified by a unit test asserting the old and new eori/registrationNumber sets are identical. Future maps over countries derive from `COUNTRY_MAP`; hand-written country lists elsewhere are a review flag.

Call-site changes (the complete set — 11 files reference the old readers):

| Site | Change |
|---|---|
| `file+/purchase-order+/$orderId[.]pdf.tsx` | `getPurchasingTerms` → `getEffectiveTerms(kind: Purchasing, supplierCountryCode from purchaseOrderLocations, orderDate)` |
| `file+/quote+/$id[.]pdf.tsx`, `file+/sales-order+/$id[.]pdf.tsx`, `file+/sales-invoice+/$id[.]pdf.tsx`, `file+/shipment+/$id[.]pdf.tsx` (4 render paths) | `getSalesTerms` → `getEffectiveTerms(kind: Sales, customer country, document date)` |
| `share+/quote.$id.tsx` | `getSalesTerms` → `getEffectiveTerms` — also fixes the pre-existing divergence from the PDF |
| `x+/templates+/$type.tsx` | `termsSeed` = `getEffectiveTerms(kind per TERMS_FIELD map, no country, today)` |
| `modules/settings/documentPreview.server.ts` | same resolver, no country, today |
| `purchasing.service.ts` / `sales.service.ts` / `settings.service.ts` | delete `getPurchasingTerms`, `getSalesTerms`, `getTerms` |

`packages/documents` is untouched: `resolveTerms`, all `TermsBlock.tsx` files, the schema, and PDF props keep their current contracts.

## UI Changes

Routes (the `serial-numbers` 4-route pattern; permission module `settings`, `role: "employee"`):

- `x+/settings+/terms-and-conditions.tsx` — list route: `TermsVersionsTable` + `<Outlet/>`; columns: name, kind, scope (Global / country flag+name / region name), effective from, effective to, a derived status badge (**Active now** / **Scheduled** / **Expired** / Inactive), updatedAt.
- `x+/settings+/terms-and-conditions.new.tsx` / `.$id.tsx` / `.delete.$id.tsx` — drawer form + delete confirm.

`TermsVersionForm` (drawer, `ValidatedForm`): kind select, name input, scope selector (Global / Country via the existing `~/components/Form/Country` combobox / Region select whose options come from `countryGroupKeys()`), `effectiveFrom`/`effectiveTo` date pickers, rich-text `Editor` (`@carbon/react/Editor`) writing JSON to a hidden field — the `TermsConfig` pattern. Editing a version whose window covers today shows the "in effect — issued documents will re-print with the new wording" warning.

Nav: one entry "Terms & Conditions" in the **System** group of `useSettingsSubmodules.tsx`; new `path.to` constants in `path.ts`.

Template editor: `TermsConfig` gains one line of helper text — "Authored content here overrides the versioned Terms & Conditions (Settings → Terms & Conditions), including region and date selection."

New UI strings go through Lingui per `.claude/rules/i18n-lingui-system.md`.

## Acceptance Criteria

- [ ] A settings admin creates a Purchasing version scoped to region `EU` effective 2026-09-01 with no end date, and a global Purchasing version; printing a PO dated 2026-09-02 for a German supplier renders the EU terms on the final page; the same print for a US supplier renders the global terms.
- [ ] A version scoped to country `DE` beats the `EU` region version for a German supplier on the same date.
- [ ] Two Purchasing versions global-scoped, v1 effective-to 2026-08-31 and v2 effective-from 2026-09-01, created in advance: a PO dated 2026-08-30 prints v1, a PO dated 2026-09-01 prints v2, with no action on the changeover day.
- [ ] With v1 expired 2026-08-31 and **no** successor, a PO dated 2026-09-05 still prints v1 (quiet fallback) — no error, no blank terms page.
- [ ] A company with no `termsVersion` rows and no template-block content prints a PO with no terms page and no errors (current behavior preserved).
- [ ] After migration, a company whose old `terms.purchasingTerms` was non-empty sees one "Standard Terms" Purchasing row (global, open-ended) in Settings, and its PO PDF output is byte-identical in content to before the change; a company whose old terms were empty gets no rows.
- [ ] Authored content in the PO template's terms block still overrides everything (existing behavior), and the template editor seed shows the currently-effective global version.
- [ ] The shared quote page (`/share/quote/...`) and the quote PDF render the same terms for the same quote.
- [ ] Settings routes 403 without `settings_view`/`settings_update`; PO PDF still renders for a user with only `purchasing_view`.
- [ ] `pnpm exec turbo run typecheck --filter=./apps/erp` passes; `pnpm run generate:types` run after the migration; unit tests cover the resolver ladder (country > group > global, date windows, both fallback stages).

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Editing an in-effect version silently changes how already-issued documents re-print | Med | Warning in the form; document-date resolution keeps reprints stable across *scheduled* changes; version-stamping on documents is the designed v2 |
| Shipment/packing-slip render paths may not have customer country loaded | Low | Verify during implementation; pass `countryCode: null` (global terms) as interim rather than extending views in this change |
| Demo datasets / dev seed don't create `termsVersion` rows (tiers may seed the old `terms` table) | Low | Check `packages/database/src/datasets/` tiers; if terms are seeded there, add a foundation-slice entry; `pnpm db:check:datasets` guards apply-ability |
| Two same-tier overlapping versions surprise users (latest `effectiveFrom` wins silently) | Low | Status badges on the list make overlaps visible; overlap is legal by design (pricingRule precedent) |
| Group membership is code — a real-world change (e.g. EU accession) needs a release, and a stored `countryGroup` key no longer derivable from the map resolves to nothing | Low | One-flag change in `COUNTRY_MAP`, same maintenance profile as the existing eori map; zod restricts the form to known keys, and an unknown stored key simply never matches (quiet, consistent with fallback rules) |
| Refactoring `COUNTRY_PROFILES` onto the base map silently changes eori/registration behavior on documents | Low | Unit test asserts old and new derived sets are identical; helper signatures unchanged |
| `terms` table left dangling (trigger keeps inserting empty rows) | Low | Deliberate; cleanup migration drops trigger + table in a follow-up release |
| Old backups restored after this change lack `termsVersion` rows | Low | Restore engine wipes and reloads whole schema-scoped tables; a pre-migration backup restores pre-migration behavior minus the read path — resolver returns null → quiet fallback (no crash). Note in release notes |

## Open Questions

> All resolved with the user in the design interview (2026-08-26) before this spec was written.

- [x] What is a "region" — country, or country group? — **Answer (user):** a region is a country; a country can fall into a country group. Terms may be scoped to either; country-specific wins over group. **Revised (user, same day, twice):** no user-managed `countryGroup` entity, and no standalone group list either — one canonical `COUNTRY_MAP` of all countries in `@carbon/utils` from which group membership and the existing `COUNTRY_PROFILES` helpers both derive.
- [x] Where does the management UI live? — **Answer (user delegated to recommendation):** a dedicated Settings → Terms & Conditions page; the template editor's terms block stays as an explicit per-document-type override.
- [x] Purchasing documents only, or sales too? — **Answer (user delegated to recommendation):** both, as one mechanism with a `kind` dimension — the render machinery is already shared.
- [x] What happens to existing terms? — **Answer (user):** they stay as-is and become version 1 (global, open-ended) via migration backfill.
- [x] Behavior when no version is effective on the document date? — **Answer (user):** fall back quietly; never block or warn at print time.
- [x] Resolution date: print date or document date? — **Answer (settled by codebase precedent, flagged to user):** document issue date, for deterministic reprints; Carbon documents are live renders, so print-date resolution would shift terms on every reprint.
- [x] Are versions immutable once in effect? — **Answer (settled by precedent, flagged to user):** editable with an in-form warning in v1; hard immutability + per-document version stamping deferred to v2.

## Out of Scope (v1)

- Per-document stamping of the applied terms version id (the full audit trail — natural v2 on top of this model).
- Language translations of terms content and of the "Terms & Conditions" heading.
- Merge-field interpolation inside versioned terms content.
- Supplier acceptance capture / PO acknowledgement flow.
- Incorporation-by-reference mode (short clause + hosted URL instead of full text).
- Duplex "print on the back of each page" — terms remain a trailing page, which satisfies the requirement's "back **or final page**".

## Changelog

- 2026-08-26: Created after design interview (5 questions resolved with user) and competitor research (`.ai/research/versioned-region-terms-and-conditions.md`).
- 2026-08-26: Dropped the user-managed `countryGroup` table/UI per user revision — region groups became static code in `@carbon/utils`; `termsVersion.countryGroupId` FK became a plain `countryGroup` TEXT key.
- 2026-08-26: Second user revision — no standalone `COUNTRY_GROUPS` list either; instead one canonical `COUNTRY_MAP` (all ISO-3166 countries + facts) in `@carbon/utils`, from which group membership AND the existing `COUNTRY_PROFILES` helpers derive, so country lists are never written twice.
- 2026-08-31: Post-implementation user revision — country scope is a **multi-select**: `countryCode TEXT` became `countryCodes TEXT[]` (empty = not country-scoped, `pricingRule` array precedent); the country tier matches when the counterparty's country is in the list; the form uses a countries `MultiSelect`. Unshipped migration edited in place.
- 2026-08-31: Post-implementation user revision — bigger editing surface and **merge-field support in versioned terms**: Insert-field menu + token highlighting in the editor, `resolveTerms` interpolates the fallback, shared quote page interpolates via `buildQuoteVars` (newly exported from `@carbon/documents/pdf`); `appendText` moved from `BlockConfig` into `@carbon/documents/template`.
- 2026-08-31: Post-implementation user revision (two changes). (1) **`kind` → `documentType`**: the `termsKind` enum (`Purchasing`/`Sales`) became `termsDocumentType` (`purchaseOrder`/`quote`/`salesOrder`/`salesInvoice`/`packingSlip`), so a version targets exactly one outgoing document. The backfill expands `salesTerms` across the four customer-facing types. Merge fields are now the document's OWN full set (`getMergeFields(documentType)`) — the four-way intersection is gone, so a quote version can use `{quote.expirationDate}`. (2) **Full-screen editor** replacing the drawer, modelled on production/procedure: `x+/terms-version+/{_layout,$id,update}.tsx` with `PanelProvider` + `ResizablePanels` (content + properties), autosaving body via the browser Supabase client and per-field property saves through `terms-version/update`. The settings list stays; New collects name + document type, then redirects into the editor.
- 2026-08-31: Post-implementation user revisions. (1) **`documentType` → `documentTypes TEXT[]`** — one version covers several documents (one row instead of four for the sales side); the resolver query filters with `.contains("documentTypes", [documentType])` and the editor's merge-field menu offers the intersection of the selected documents' fields. (2) **Counterparty scope** — new `customerIds`/`supplierIds` arrays add a MOST-specific tier to the ladder: **named counterparty > country > region group > global**. The service normalizes to a single `partyIds` per document (a PO's counterparty is a supplier; every other terms-bearing document is customer-facing) so the pure resolver stays generic, and each document route passes its counterparty id. A DB CHECK keeps the three scope dimensions mutually exclusive, and another requires at least one document type.
- 2026-08-31: Post-implementation user revision — **region groups removed for now**. The `EU` group key, the `groups` flag on `COUNTRY_MAP`, `groupsForCountry`/`countryGroupKeys`, the `termsVersion.countryGroup` column, and the Region scope option are all gone. The ladder is now **named counterparty > country > global**; `COUNTRY_MAP` keeps its name/alpha3/eori/registrationNumber facts and stays the single source of country truth, so a group dimension can be reintroduced additively later.
