# Ramp Card-Transaction Merchant Modeling — implementation plan

**Spec:** .ai/specs/2026-09-17-ramp-card-merchant-modeling.md
**Research:** .ai/research/card-transaction-merchant-modeling.md
**Branch:** feat/feat-ramp

## Progress
- [x] Task 1: Rewrite `resolveMerchantSupplier` to match-or-catch-all (no per-merchant create)
- [x] Task 2: Unit-test the new merchant resolution order
- [x] Task 3: Carry `merchantName` on the provider charge line description (Rillet/QBO/Xero)
- [x] Task 4: Update the three charge adapter tests to assert merchant-in-description
- [x] Task 5: Scoped typecheck + test verification for `@carbon/ee`
- [x] Task 6: Sync docs/rules to the new behavior

## Dependencies
- Task 2 needs Task 1. Task 4 needs Task 3. Tasks 1+2 are independent of Tasks 3+4 (different files) — they MAY run in parallel.
- Task 5 needs Tasks 1–4. Task 6 needs Tasks 1 + 3.

## Notes for the executor
- No database migration, no `generate:types`, no UI, no settings toggle. This is a behavior change in `@carbon/ee` only.
- `CardChargeSource` (`packages/ee/src/accounting/core/card-charge-source.ts`) already has `merchantName: string | null`, and all three providers alias `CardCharge = CardChargeSource`, so `charge.merchantName` is in scope in each adapter's `mapToRemote`. It is already SELECTed in `loadCardChargeSources` — no query change needed.
- The card sync family runs `concurrency: { key companyId, limit 1 }`, so a plain find-then-insert for the single house supplier is race-safe within a company.
- Never run a whole-repo typecheck (OOM). Scope to `--filter=@carbon/ee`.

---

## Task 1: Rewrite `resolveMerchantSupplier` to match-or-catch-all (no per-merchant create)

**Depends on:** none
**Files:**
- Modify: `packages/ee/src/ramp/lib/suppliers.ts` — replace the body of `resolveMerchantSupplier` (it currently delegates to `resolveRampSupplier`, which auto-creates a supplier per merchant); add a private `resolveCardMerchantCatchAllSupplier` helper and a `CARD_MERCHANT_SUPPLIER_NAME` constant.
- Copy from (precedent): the `resolveEmployeeSupplier` find-or-create pattern in the same file (~lines 150–230) and `ensureSupplierTypeId` (~lines 90–115).

**Steps:**

1. Add a constant next to `CARD_MERCHANT_SUPPLIER_TYPE`:
   ```typescript
   /** The single house supplier all one-off card merchants collapse to. */
   export const CARD_MERCHANT_SUPPLIER_NAME = "Card Merchant";
   ```

2. Replace the ENTIRE current `resolveMerchantSupplier` function body with this (keep the exported signature identical):
   ```typescript
   export async function resolveMerchantSupplier(
     serviceRole: SupabaseClient<Database>,
     kyselyDb: Kysely<KyselyDatabase>,
     companyId: string,
     merchant: { id?: string | null; name: string }
   ): Promise<string> {
     const mapping = createMappingService(kyselyDb, companyId);
     const supplierTypeId = await ensureSupplierTypeId(
       serviceRole,
       companyId,
       CARD_MERCHANT_SUPPLIER_TYPE
     );

     // 1. Mapping-first — a merchant we've resolved before keeps its supplier.
     if (merchant.id) {
       const mapped = await mapping.getEntityId(RAMP, merchant.id, "merchant");
       if (mapped) return mapped;
     }

     // 2. Exact-name match to an EXISTING supplier. If the merchant is a real
     // vendor you already trade with, link card spend to it. `%`/`_` escaped so a
     // merchant like "50% Off Supply" cannot become a wildcard pattern.
     const escapedName = merchant.name.replace(/[\\%_]/g, (m) => `\\${m}`);
     const { data: matches } = await serviceRole
       .from("supplier")
       .select("id")
       .eq("companyId", companyId)
       .ilike("name", escapedName)
       .limit(1);
     const matchedId = matches?.[0]?.id ?? null;
     if (matchedId) {
       if (merchant.id) {
         await mapping.link("merchant", matchedId, RAMP, merchant.id, {
           createdBy: "system"
         });
       }
       return matchedId;
     }

     // 3. Fall back to the ONE "Card Merchant" house supplier — never a new
     // supplier per merchant. Deliberately NO per-merchant mapping is written,
     // so the mapping table does not re-accumulate one row per merchant; the
     // catch-all is resolved by its stable identity every sync.
     return resolveCardMerchantCatchAllSupplier(
       serviceRole,
       companyId,
       supplierTypeId
     );
   }

   /**
    * Find-or-create the ONE house "Card Merchant" supplier for the company — the
    * catch-all that carries card spend whose merchant is not (yet) a real vendor.
    * One row per company; the card sync's per-company concurrency (limit 1)
    * serializes creation, so a plain find-then-insert is race-safe.
    */
   async function resolveCardMerchantCatchAllSupplier(
     serviceRole: SupabaseClient<Database>,
     companyId: string,
     supplierTypeId: string
   ): Promise<string> {
     const existing = await serviceRole
       .from("supplier")
       .select("id")
       .eq("companyId", companyId)
       .eq("name", CARD_MERCHANT_SUPPLIER_NAME)
       .eq("supplierTypeId", supplierTypeId)
       .maybeSingle();
     if (existing.data?.id) return existing.data.id;

     const created = await serviceRole
       .from("supplier")
       .insert([
         {
           name: CARD_MERCHANT_SUPPLIER_NAME,
           supplierTypeId,
           companyId,
           createdBy: "system"
         }
       ])
       .select("id")
       .single();
     if (created.error || !created.data) {
       throw new Error(
         `Failed to create the Card Merchant supplier: ${
           created.error?.message ?? "unknown error"
         }`
       );
     }
     return created.data.id;
   }
   ```

3. Do NOT change `resolveRampSupplier` or `resolveEmployeeSupplier` — bills/POs (`vendor` entityType) still auto-create by design. Only the merchant path changes. Confirm `resolveMerchantSupplier` no longer references `resolveRampSupplier`.

4. If `createMappingService`, `RAMP`, `ensureSupplierTypeId`, `SupabaseClient`, or the `Kysely`/`KyselyDatabase` types are not already imported at the top of the file, they are (verify) — do not add duplicate imports. If any is genuinely missing, STOP and report — do not guess a new import path.

**Verify:**
```bash
cd /Users/barbinbrad/conductor/workspaces/carbon/brisbane
grep -n "resolveCardMerchantCatchAllSupplier\|CARD_MERCHANT_SUPPLIER_NAME\|resolveRampSupplier" packages/ee/src/ramp/lib/suppliers.ts
# Expected: resolveMerchantSupplier contains resolveCardMerchantCatchAllSupplier and NOT resolveRampSupplier;
#           resolveRampSupplier still exists (used by the vendor/bill path).
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: typecheck passes (Tasks: 1 successful).
```

**Out of scope:** `resolveRampSupplier`, `resolveEmployeeSupplier`, the `ramp-sync-card.ts` call site (it already passes `{ id, name }` and stores the returned id — no change), any settings/schema.

---

## Task 2: Unit-test the new merchant resolution order

**Depends on:** Task 1
**Files:**
- Create: `packages/ee/src/ramp/lib/__tests__/suppliers.test.ts`
- Copy from (precedent): `packages/ee/src/ramp/lib/__tests__/service.test.ts` (mocking style for a service-role Supabase client + Kysely mapping) and `coding.test.ts` (vitest layout).

**Steps:**
1. Write a vitest suite for `resolveMerchantSupplier` with a fake `serviceRole` (stub `.from("supplier")` select/insert and `.from("supplierType")`) and a fake mapping service (stub `createMappingService` via `vi.mock("../../accounting/core/external-mapping")` returning `{ getEntityId, link }`). Cover these cases as separate `it` blocks:
   - **mapping hit** → returns the mapped id; no `supplier` insert; no name query.
   - **name match** → an existing supplier with the exact name is returned; `mapping.link("merchant", <id>, RAMP, <merchantId>)` is called once; no insert.
   - **catch-all create** → no mapping, no name match → inserts ONE supplier named `"Card Merchant"`; returns its id; `mapping.link` is NOT called for the merchant id (assert `link` not called with `"merchant"`).
   - **catch-all reuse** → second unmatched merchant in the same company finds the existing `"Card Merchant"` supplier (select returns it) → NO second insert.
   - **name escaping** → a merchant named `"50% Off"` produces an `ilike` argument of `"50\\% Off"` (assert the value passed to `.ilike`).
2. Use `vi.fn()` spies to assert call counts (insert called 0 or 1 times as above).
3. If the existing test files import a shared test helper for the fake Supabase client, reuse it; otherwise build a minimal inline stub. If you cannot determine the mapping-service mock shape from `external-mapping.ts`, read that file first — do not guess method names beyond `getEntityId(provider, externalId, entityType)` and `link(entityType, entityId, provider, externalId, opts)` (both confirmed in `suppliers.ts`).

**Verify:**
```bash
cd /Users/barbinbrad/conductor/workspaces/carbon/brisbane
pnpm --filter @carbon/ee test -- suppliers
# Expected: the new suppliers.test.ts suite passes (all it blocks green).
```

**Out of scope:** integration tests hitting a real DB; testing `resolveRampSupplier`/`resolveEmployeeSupplier` (unchanged).

---

## Task 3: Carry `merchantName` on the provider charge line description (Rillet/QBO/Xero)

**Depends on:** none (independent of Tasks 1–2)
**Files:**
- Modify: `packages/ee/src/accounting/providers/rillet/entities/charge.ts` — line ~162.
- Modify: `packages/ee/src/accounting/providers/quickbooks-online/entities/charge.ts` — line ~203.
- Modify: `packages/ee/src/accounting/providers/xero/entities/charge.ts` — line ~212.

**Steps:**
1. In EACH of the three files, find the line:
   ```typescript
   const description = line.description ?? charge.memo ?? undefined;
   ```
   and change it to:
   ```typescript
   // Merchant identity rides here on the charge line: card spend now shares one
   // catch-all vendor, so without this the pushed charge would lose which
   // merchant it was at (the vendor no longer carries it).
   const description = charge.merchantName ?? line.description ?? charge.memo ?? undefined;
   ```
2. This is the exact same edit in all three adapters. Do not change `vendor_id`/`vendorRemoteId`, `Reference`, `DocNumber`/`PrivateNote`, `memo` handling elsewhere, amounts, or the void/lifecycle paths.
3. If any file's line differs from the quoted `const description = line.description ?? charge.memo ?? undefined;` (e.g. already references `merchantName`), STOP and report — do not force the edit.

**Verify:**
```bash
cd /Users/barbinbrad/conductor/workspaces/carbon/brisbane
grep -rn "charge.merchantName ?? line.description ?? charge.memo" packages/ee/src/accounting/providers/*/entities/charge.ts
# Expected: exactly 3 matches (rillet, quickbooks-online, xero).
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: typecheck passes.
```

**Out of scope:** header-level fields (Xero `Reference`, QBO `DocNumber`/`PrivateNote`), the card-charge-source query (already selects `merchantName`), the QBO/Xero live-sandbox verification (env-gated — see Task 5).

---

## Task 4: Update the three charge adapter tests to assert merchant-in-description

**Depends on:** Task 3
**Files:**
- Modify: `packages/ee/src/accounting/providers/rillet/entities/__tests__/charge.test.ts`
- Modify: `packages/ee/src/accounting/providers/quickbooks-online/entities/__tests__/charge.test.ts`
- Modify: `packages/ee/src/accounting/providers/xero/entities/__tests__/charge.test.ts`

**Steps:**
1. In each charge test, locate the test that builds the remote payload from a `CardCharge`/`CardChargeSource` fixture with a non-null `merchantName`. Add (or extend) an assertion that the built line's description carries the **merchant name** when `merchantName` is set:
   - Rillet: the item's `description` equals the fixture `merchantName`.
   - QBO: the line's `Description` equals the fixture `merchantName`.
   - Xero: the line item's `Description` equals the fixture `merchantName`.
2. If a fixture currently has `merchantName: null`, set it to a distinct value (e.g. `"Acme Fuel"`) that differs from `memo` and any `line.description`, so the assertion proves precedence (merchant wins over memo).
3. Add one case per file where `merchantName` is null and a `line.description`/`memo` is present → description falls back to `line.description ?? memo` (proves the `??` chain still degrades correctly).
4. If a test fixture has no obvious place to set `merchantName`, read the fixture builder in that test file and set it on the source object passed to `mapToRemote`/the builder. Do not invent a new fixture shape — extend the existing one.

**Verify:**
```bash
cd /Users/barbinbrad/conductor/workspaces/carbon/brisbane
pnpm --filter @carbon/ee test -- charge
# Expected: all three providers' charge tests pass, including the new merchant-description assertions.
```

**Out of scope:** `charge-lifecycle.test.ts` (void/delete lifecycle — unaffected), `card-charge-source.test.ts` unless the loader changed (it did not).

---

## Task 5: Scoped typecheck + test verification for `@carbon/ee`

**Depends on:** Tasks 1–4
**Files:** none (verification only)

**Steps:**
1. Run the package typecheck and the full package test suite to confirm nothing else regressed (the resolver and charge adapters are imported widely).
2. Note in the run record that **live Rillet-sandbox verification of the merchant-on-charge acceptance criterion is env-gated** (needs Ramp/Rillet sandbox creds on this dev company) and cannot run here — flag it for the user as a manual follow-up, do not fabricate a result.

**Verify:**
```bash
cd /Users/barbinbrad/conductor/workspaces/carbon/brisbane
pnpm exec turbo run typecheck --filter=@carbon/ee
# Expected: typecheck passes.
pnpm --filter @carbon/ee test
# Expected: full @carbon/ee suite green (no regressions in ramp/ or accounting/).
```

**Out of scope:** ERP app typecheck (no ERP files changed); browser/e2e (no UI change).

---

## Task 6: Sync docs/rules to the new behavior

**Depends on:** Tasks 1 + 3
**Files:**
- Modify: `.claude/rules/ramp-integration.md` — the "Card transactions → the accounting provider" section and the `resolveMerchantSupplier` description (currently says "auto-create tagged with the 'Card Merchant' supplier type" per merchant).
- Modify: `.claude/rules/accounting-sync-handlers.md` — the "Card charges as provider objects" section where it documents `resolveMerchantSupplier` (mapping → name → auto-create) and merchant/vendor on the charge.
- Modify: `packages/ee/AGENTS.md` — only if it references per-merchant supplier creation (grep first; edit only if a stale claim exists).

**Steps:**
1. Update the `resolveMerchantSupplier` description in both rules to the new order: **mapping-first → exact-name match to an existing supplier (links it) → single catch-all "Card Merchant" house supplier (no per-merchant mapping/creation)**. State that merchant identity now rides on the provider charge **line description** (`charge.merchantName ?? line.description ?? charge.memo`), because all card spend shares the catch-all vendor.
2. Add a one-line pointer to the spec: `.ai/specs/2026-09-17-ramp-card-merchant-modeling.md`.
3. Keep edits factual and scoped to what changed; do not rewrite unrelated sections. Document committed behavior only.

**Verify:**
```bash
cd /Users/barbinbrad/conductor/workspaces/carbon/brisbane
grep -n "catch-all\|Card Merchant house\|merchantName ?? line.description" .claude/rules/ramp-integration.md .claude/rules/accounting-sync-handlers.md
# Expected: both rules describe the catch-all resolution and the merchant-on-description behavior.
```

**Out of scope:** user-facing `docs/` site (separate follow-up), the deferred "Merchant dimension" feature.
