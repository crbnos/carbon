# Item Rules — enforcement surface audit

**Date:** 2026-08-12
**Question:** Item rules fire when an item is added to a quote line or sales order line. Where *else* can an item reach a sales document, and what events should force re-evaluation? This audit exists to decide where enforcement belongs before more call sites are added one at a time.

Like the 2026-08-11 research file, this surveys Carbon's own codebase rather than competitors. Every claim below is cited to source; the citations are the evidence. Findings were produced by six parallel code audits (ERP write paths, edge functions and background jobs, external/API surfaces, context-drift triggers, the sales pipeline, and architecture options) and the load-bearing ones were re-verified by hand.

## 1. What is enforced today

`evaluateItemRuleLines` (`packages/ee/src/rules/item/server.ts:72`) is called from **exactly four places in the repo**, all ERP route actions:

| Route | Surface |
|---|---|
| `x+/quote+/$quoteId.new.tsx:77` | `quoteLine` create |
| `x+/quote+/$quoteId.$lineId.details.tsx:200` | `quoteLine` update |
| `x+/sales-order+/$orderId.new.tsx:86` | `salesOrderLine` create |
| `x+/sales-order+/$orderId.$lineId.details.tsx:152` | `salesOrderLine` update |

There are no DB triggers, no RLS involvement, and no service-layer checks. `itemRuleSurface` has exactly two values (`20260810214426_item-rules-sales.sql:4`), so no other surface is even expressible.

## 2. The write surface is non-exhaustible

**14 entry points can put an `itemId` on a sales line; 4 are enforced.** Collapsed by underlying writer — 9 writers, 2 enforced:

| Writer | Reached from | Enforced |
|---|---|---|
| `upsertQuoteLine` (`sales.service.ts:3788`) / `upsertSalesOrderLine` (`:5528`) | the 4 line routes | route only |
| `convert` edge fn — quote→SO (`convert/index.ts:691`) | `$quoteId.convert.tsx:72`; **unauthenticated** `api+/sales.digital-quote.$id.tsx:92` | no |
| `convert` edge fn — RFQ→quote (`convert/index.ts:1231`) | `sales-rfq+/$rfqId.convert.tsx:25` | no |
| `get-method` — `quoteToQuote` (`get-method/index.ts:5724`) | `$quoteId.duplicate.tsx:29` | no |
| `upsertQuoteLine` via CAD drag (`$quoteId.drag.tsx:157`) | mints a part, then a line | no |
| `insertSalesOrderLines` (`sales.service.ts:1955`) | **MCP only — no in-app caller** | no |
| Paperless Parts (`packages/ee/src/paperless-parts/lib/lib.ts:2770`, `:3022`) | inbound webhook → Inngest, service role | no |

Two of these are structural, not incidental:

**The MCP executor makes route-level enforcement unsound.** `apps/erp/app/routes/api+/mcp+/lib/direct-executor.ts:84` resolves *any named export* of `sales.service.ts` and invokes it under an OAuth or `carbon-key` identity. The blocklist (`mcp-blocked-tools.ts:5-12`) has three entries, none sales-related, so `sales_upsertQuoteLine`, `sales_upsertSalesOrderLine`, `sales_insertSalesOrderLines`, and `sales_convertQuoteToOrder` are all callable. The same function the enforced route protects is reachable unprotected. That `insertSalesOrderLines` has no in-app caller and exists only because MCP exposes it is the clearest evidence that writer #10 is a matter of time.

**The digital-quote accept path has no employee session.** `api+/sales.digital-quote.$id.tsx:92` runs service-role with `userId` spoofed to `quote.createdBy`; the only credential is the share-link id. Whatever runs there cannot be warn-and-acknowledge — there is nobody to show a modal to.

### Related pipeline findings

- **A standalone sales invoice reaches GL revenue with no upstream document.** `x+/sales-invoice+/new.tsx:42` has a default branch creating an invoice with no source document; `$invoiceId.new.tsx:71` then adds item-bearing lines (`itemId` required for Part/Service/Material/Tool/Consumable, `invoicing.models.ts:266`), guarded only by `requireUnlocked` + `create: "invoicing"`.
- **RFQ→quote conversion auto-creates item master rows.** `convert/index.ts:967-1017` mints an `item` for every RFQ line without one (`type: "Part"`, `active: false`, hardcoded defaults), back-fills `salesRfqLine.itemId`, then inserts quote lines from them. These items carry no `itemRuleAssignment` rows, so assignment-based rules cannot match and attribute-based rules see placeholder values. Quote→SO then flips them `active: true` (`convert/index.ts:695`).
- **Shipment lines are safe by construction.** There is no add-line route and no shipment line form; every insert is edge-function-derived from a sales order line. An item cannot reach a shipment without an SO line.

## 3. Three paths execute no Carbon TypeScript at all

This is what decides the architecture. App-layer enforcement **cannot be made complete** as currently architected:

1. **Direct PostgREST.** The documented integration model is a supabase client with a `carbon-key` header (`README.md:443-471`); the published OpenAPI dump advertises `POST /quoteLine` (`swagger-docs-schema.ts:1650`); and Carbon's own shipped example does `client.from("quoteLine").insert(...)` (`contrib/building/examples/quote-configurator/app/lib/carbon.server.ts:259`). The only gate is RLS (`20260228000000_rls-refactor-3.sql:1639`), which understands `companyId` and `sales_create` and nothing else. A service-role key has no RLS at all.
2. **`SECURITY DEFINER` RPCs with weaker guards than the tables they write.** `create_rfq_from_models_v2` (`20250314184246_opportunity-refactor.sql:298-302`) is guarded by `has_role('employee') OR has_valid_api_key_for_company()` with **no scope check**, is never `REVOKE`d, and is published at `swagger-docs-schema.ts:85486`. A zero-scope API key can create sales RFQs.
3. **Service-role paths with no user session** — the digital-quote accept route and the Paperless Parts Inngest job. RLS is off by construction; the only guards are hand-written in each handler.

Unrelated but found en route: five tables still carry the legacy blanket API-key policy from `20240821150639_api-key-all-tables.sql` (including `quoteOperationWorkInstruction`), which ignores scopes entirely.

## 4. Defects in the shipped implementation

Independent of any scope decision. The first two were hand-verified.

- **Drop shipments evaluate the wrong destination.** The evaluator reads `salesOrder.customerLocationId` (`$orderId.new.tsx:95`), but a drop shipment's real ship-to is `salesOrderShipment.customerLocationId`, required when `dropShipment` is set (`sales.models.ts:757-776`). A country rule can clear an order that ships elsewhere — no bypass required. This defeats the motivating export-control use case.
- **`acknowledged` is client-supplied with no server-side state.** The server reads `formData.get("acknowledged") === "true"` (`$quoteId.new.tsx:76`) and nothing records that a violation was ever displayed; the client replays the original FormData with the flag appended (`use-violations.tsx:150-160`). A crafted first submit skips every `warn` gate. Errors still block unconditionally (`isBlocked`, `rules/storage/server.ts:55-64`), so the blast radius is warnings only. The MES picking route defends against the analogous hazard (`apps/mes/.../picking.$pickingListId.status.tsx:65-93`); the rules layer does not.
- **Quantity rules are dead on quotes.** Both quote call sites hardcode `quantity: 1` (`$quoteId.new.tsx:85`, `$quoteId.$lineId.details.tsx:208`); the real quantity is first chosen at conversion, which is unenforced.
- **`itemRuleAcknowledgment` has six writers and no reader.** The evidence log is never queried, surfaced, or reported on.

## 5. The verdict is point-in-time and never revisited

Context is resolved live at write (`rules/item/server.ts:91-114`) and never snapshotted. Drift vectors:

- **Ship-to is editable after lines exist.** The only guard is a status lock, and `isSalesOrderLocked` (`sales.models.ts:963-971`) leaves Draft, In Progress and Needs Approval editable. Live paths: `x+/quote+/update.tsx:88-104`, `x+/sales-order+/update.tsx:95-112`.
- **Addresses are shared by reference.** `customerLocation` is a thin join to `address`; editing a location mutates the shared `address` row in place (`sales.service.ts:2998-3003`), retroactively changing the resolved country for every document pointing at it. CSV import does this in bulk (`import-csv/index.ts:629-634`).
- **Deletes silently null the inputs.** Deleting a customer type or status nulls the customer field (`ON DELETE SET NULL`, `20230123004612:222-223`); deleting a location nulls `customerLocationId` (`20241205165946:5,14`), converting a country rule into a required-field violation.
- **Rule authorship has no backfill.** No trigger, no Inngest event, no matview. A line saved before a rule existed renders clean forever.
- **Supersession diverges from the sales line.** Production-side paths redirect to the successor item (job explosion `get-method/index.ts:6112-6128`, MRP, picking `inventory.service.ts:3352-3358`) while the sales line keeps the original `itemId` — so a Make-to-Order line can build a different item than the rule cleared.

## 6. Precedent: Carbon already has terminal-gate validation

`x+/shipment+/$shipmentId.post.tsx` is the reference implementation, and the pattern is running in seven places (receipt post, shipment post, stock transfer status, warehouse transfer status, inventory adjustment, plus MES). The shape:

1. `requirePermissions` for the actor, then a **service-role** client so the check sees full truth (`:36`)
2. read `acknowledged` off the form (`:33`)
3. load **every line on the document** (`:37-44`)
4. accumulate violations across surfaces into one array (`:68-99`)
5. `dedupeViolations` → `isBlocked(deduped, acknowledged)` — any error blocks; warns block until acknowledged
6. **return** (not throw) `{ violations, ruleNames }` (`:102-109`)
7. client: `useRuleViolations` + `RuleViolationModal`, acknowledge re-posts with the flag

`getOverReceiptViolations` (`packages/utils/src/receiving.ts:24-68`) shows the same envelope carrying a *synthetic* violation with a pseudo rule id — the precedent for injecting non-configurable checks into the shared modal with zero new UI.

Notably absent: there is **no credit-limit, customer-hold, or approval mechanism** anywhere in Carbon. `customerStatus` is a plain lookup whose only functional role is as an item-rule condition. Item rules *are* the intended mechanism for "this customer shouldn't be sold anything."

## 7. Decisions taken (2026-08-12)

- **Gate at lifecycle transitions, not at every write.** Item rules are a compliance control, and compliance fails at the document, not the line. A gate re-reads the whole document, so it covers writers nobody instrumented *and* catches staleness. Per-line checks stay for early feedback.
- **Add item rules to shipment posting.** It is the last physical checkpoint, the plumbing already exists in that exact file, and it is the first moment a real shipped quantity exists.
- **No nightly sweep.** Drafts are a scratchpad — users should be free to experiment, and the confirm gate catches it before it counts. Dropping it removes a cron, a new violation-state table, and notification-fatigue tuning. Accepted residual: rules authored *after* an order is confirmed are caught at shipment post rather than immediately.
- **No rule-impact preview** ("what does my new rule break?"). Explicitly declined.
- **No invoice-post gate for service-only orders — known gap.** Services are `Non-Inventory` items (`items.service.ts:4825`) that are never shipped, so a service-only order skips shipment entirely and goes straight to `To Invoice` (`convert/index.ts:552-560`). Shipment post therefore never fires for them. Deferred until a rule actually needs to apply to a service; invoice posting is the hook if so.
- **No Postgres trigger for now.** Revisit only if a real bypass survives the gates — a UI/DB disagreement is worse than a known gap for a compliance feature.

## 8. Carried into the spec

Phase 3 (enforcement completeness): gates at quote finalize, sales order confirm, both conversion routes, and shipment post; hard-error checks pushed into `upsertQuoteLine`/`upsertSalesOrderLine` with `sales_insertSalesOrderLines` blocklisted in MCP; the three defects in §4 fixed; `Violation` extended with line attribution so a document-level modal can attribute and deep-link; engine relocated to `supabase/functions/shared/` with `export *` barrels (following `packages/database/src/sampling.ts:1-5`) to foreclose future hand-copying — `shared/tiptap.ts` has already drifted to 27 lines against 197.
