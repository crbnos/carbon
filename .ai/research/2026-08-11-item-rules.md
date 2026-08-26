# Item Rules — codebase research for a sales-document rule engine

**Date:** 2026-08-11
**Question:** How should Carbon implement "item rules" — configurable *if-condition-then-error/warn* rules that fire when items are added to quotes and sales orders (e.g. "if item type is X and customer location is Y, block") — with one common error interface so multiple checks never stack separate modals? What existing infrastructure should it build on, and what data is available at the enforcement points?

Unlike most research files, this one surveys Carbon's own codebase rather than competitors: the request explicitly said "base it off storage rules," so the research questions were (1) what the storage-rules engine actually is, (2) how customer/location data reaches sales documents, and (3) what interstitial-check patterns already exist at line-add time. All findings verified against source; file references are the citations.

## 1. The storage-rules engine — and the naming surprise

The feature to clone began life under the exact name being requested: the original migration is `packages/database/supabase/migrations/20260507120000_item-rules.sql` creating a table `itemRule`, later renamed `itemRule → customRule → storageRule` (`20260603130000`). The underlying engine is a **generic predicate engine**, not storage-specific. Three layers:

**Pure engine** (`packages/utils/src/storage-rules.ts` + `field-registry.ts`, client-safe, no I/O):
- Condition AST: `{ kind: all|any|none, conditions: [{ field, op, value }] }`; operators `eq, neq, in, notIn, isSet, isNotSet, gt, lt` (`storage-rules.ts:16-24, 91-107`).
- JIT-compiled predicates with an FNV-1a-keyed 256-entry LRU (`compileRule`/`compileWithCache`, `:269/:317`).
- **Required-field semantics**: any non-presence condition whose field resolves empty emits "`{label}` is required" *before* predicate evaluation (`findFirstMissingRequiredField`, `:430-448`) — rules double as presence checks.
- Message `{token}` interpolation incl. `{condition[n].name}` id→label resolution (`interpolateMessage`, `:377-417`).
- A field registry (`FIELD_REGISTRY`) declaring exactly what rules may reference, with per-surface context availability (`SURFACE_CONTEXT_AVAILABILITY`, `:566`) enforced by validator and an anti-drift test. `item.customFields.*` paths are synthesized dynamically (`field-registry.ts:319-333`) — the extensibility valve.
- Item-scoped broadcast filtering: `filteredItemTypes`/`filteredItemGroupIds`/`filteredItemMatchAll` + `itemRuleAppliesToItem` (`:518-535`).

**Server evaluator** (`packages/ee/src/storage-rules/server.ts`): `evaluateLinesForSurface()` (`:323`) loads rules (explicit assignments + filtered broadcasts), batch-loads context rows, compiles, evaluates, dedupes. `isBlocked(violations, acknowledged)` (`:56`): any `error` blocks unconditionally; `warn`s block until acknowledged. Runs with `getCarbonServiceRole()` (RLS bypassed) from route actions — the route's `requirePermissions` is the action gate. Plan-gated via `packages/ee/src/plan.ts` `FEATURE_PLANS` — which, notably, **already contains an `ITEM_RULES` key** (`plan.ts:12`).

**The common error interface** (`packages/ee/src/storage-rules/violation-modal.tsx` + `use-violations.tsx`): one modal grouping all violations into Errors/Warnings; confirm disabled on any error; warnings-only shows "Acknowledge & continue" which re-posts the same FormData with `acknowledged=true`. Call sites swap `fetcher.submit` for `rules.submit` and render `<rules.ViolationModal/>`. Canonical server wiring: `apps/erp/app/routes/x+/shipment+/$shipmentId.post.tsx:34-111`.

**The gap:** the surface enum covers only inventory + MES surfaces; `RuleContext` has no customer root. Those are the two extension points — everything else is reusable as-is.

## 2. Customer classification and ship-to country

- `customer.customerTypeId` → `customerType`; `customer.customerStatusId` → `customerStatus` (`20230123004612_suppliers-and-customers.sql:206-233`). Both nullable FKs.
- Ship-to country: `customerLocation.addressId → address.countryCode`. **Countries are alpha-2 codes app-wide**: migration `20240928155702_country-codes.sql` dropped `country.id` and made **`alpha2` the primary key**, with `address.countryCode` TEXT referencing it. The shared `Country` selector already uses alpha2 values (`~/components/Form/Country.tsx:31-34`); tax views join on it; CSV import documents it (`imports.models.ts:584`). ⇒ rule ASTs store alpha2; evaluation is a direct string comparison.
- Quote and salesOrder headers both carry `customerId` + nullable `customerLocationId`. Quotes have a ready country view (`quoteCustomerDetails.customerCountryCode`, `20240715135710`); sales orders resolve via the `getCustomerLocation` embed (`sales.service.ts:580-591`).
- `customerLocationId` being nullable is a design point, not an obstacle: a rule referencing `customer.location.countryCode` on a document without a ship-to hits the engine's required-field semantics → "Customer location is required," inheriting the rule's severity (fail closed, helpfully).

## 3. Line-add flows and existing interstitials

- Create actions: `x+/quote+/$quoteId.new.tsx` (validate → `upsertQuoteLine`) and `x+/sales-order+/$orderId.new.tsx` (validate → `upsertSalesOrderLine`); edit actions in the `$lineId.details.tsx` siblings. Both forms read the document header from route data, so `customerId` is in scope client-side at line-add time.
- **No competing blocking modal exists on sales-line add today.** The only interstitials: the inline, non-blocking supersession notice in the shared `Item` selector (`~/components/Form/Item.tsx:398-433`) and the quote-only `ConfiguratorModal`. There is no credit-hold, MOQ, price-floor, or "not sellable" check anywhere in the sales module — the one-modal goal is achievable by simply routing the new check through the existing violation interface.
- Item type is available on the submitted line (`quoteLine.itemType`; `salesOrderLine.salesOrderLineType`, a wider enum incl. Comment) and client-side via the `useItems()` store; the evaluator re-verifies from `item.type` server-side.

## 4. What becomes possible beyond the motivating rule

With item + customer + line context, one engine covers a family of otherwise-bespoke features: export control (item flag × customer country), customer-on-hold (a credit-hold feature for free), obsolescence warnings folded into the same modal, tracking-discipline warnings, unreleased-revision warnings, and document-hygiene required-field rules. Custom fields on item and customer make any company-defined flag rule-able with zero code change. Future surfaces (purchasing/AVL — subcontracting a controlled part *is* an export; margin floors once price/qty context is added) reuse the same machinery.

## 5. Design conclusion (carried into the spec)

Separate `itemRule` table + Items-module home (clean `parts_*` permissions, own sidebar entry, own DB enum `itemRuleSurface` — do not extend the storage `transactionSurface` enum), **shared** pure engine, evaluator pattern, and violation modal. Service-role evaluation like storage rules. Enterprise plan gate on the existing `ITEM_RULES` key. Alpha-2 country values. Missing ship-to → required-field semantics. Notifications through the existing notify fan-out plus a persisted `itemRuleAcknowledgment` table — an improvement over storage rules, where acknowledgments are only a transient form flag. Naming: `item-rules`, following the established storage-rules / pricing-rules / approval-rules family; the configurator's `$itemId.rule` routes are a known collision to steer around.

Two stale-doc findings for whoever touches the engine: `packages/utils/AGENTS.md` described `storage-rules.ts` as "Supabase storage bucket access policies" (it is the rule engine), and older references to a `db:build` script are dead.

**Spec:** `.ai/specs/2026-08-11-item-rules.md`
