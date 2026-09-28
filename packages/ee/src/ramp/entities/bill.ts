/**
 * Carbon purchase invoice → Ramp DRAFT bill ("provisional bill").
 *
 * Only the WIRE lives here. What to load, which invoices are eligible, and how a
 * posted journal becomes document-currency coded lines are Carbon-side and
 * shared — `spend/bill-source.ts` and `spend/gates.ts`.
 *
 * Carbon codes and hands off a draft; the customer completes payment method and
 * payee contact in Ramp, then approves and pays there. Carbon never submits —
 * `POST /bills/drafts/{id}/submit` needs per-vendor Ramp bill-pay config Carbon
 * does not own (verified live 2026-09-11: submit 400s `BILL_PAY_7145`).
 *
 * **The push is create-once, and that is a RAMP fact**: a Ramp draft has no
 * delete endpoint (verified 405/404), so re-creating would leave the customer
 * with two bills for one invoice and no way to remove either. A platform that
 * can retract a draft could update instead — which is why this rule lives here
 * and not in the shared source.
 *
 * Live-verified constraints that are NOT free to change:
 *
 * - `remote_id: invoice.id` is the echo guard AND the bill-match key the inbound
 *   `ramp-bills` step dedupes on.
 * - Never send `enable_accounting_sync: false` alongside `remote_id` — Ramp 422s
 *   that combination.
 * - Line amounts are decimals in DOCUMENT currency.
 */

import {
  loadBillPushLines,
  loadBillPushSource,
  loadPushedCoding,
  type SpendBillSource
} from "../../spend/bill-source";
import { isPushableInvoiceStatus } from "../../spend/gates";
import { describeMissingVendorFields } from "../../spend/parties";
import { buildRampIdempotencyKey } from "../lib/client";
import { buildLineCodingSelections } from "../lib/coding";
import { resolveOrCreateRampSpendVendor } from "../lib/spend";
import { RampPushOnlyEntitySyncer } from "./shared";

export type RampBillRemote = {
  vendor_id: string;
  invoice_number: string;
  invoice_currency: string;
  issued_at?: string;
  due_at?: string;
  memo?: string;
  remote_id: string;
  line_items: Array<{
    memo?: string;
    amount: number;
    accounting_field_selections: ReturnType<typeof buildLineCodingSelections>;
  }>;
};

/**
 * What the bill says about itself beyond the supplier's invoice number.
 *
 * Two facts, one field, because `invoice_number` is reserved for the SUPPLIER's
 * reference — that is the number an AP clerk matches against the paper, and
 * Carbon's own id there would be wrong. Without the memo a bill in Ramp read
 * only `CEX-Q-4471`, with nothing tying it back to `AP000008` or to the orders
 * it settles. Bare ids rather than a sentence, so a Ramp search for either finds
 * this bill.
 *
 * This is a HUMAN trace, and deliberately not Ramp's own bill↔order link. That
 * link does exist and Carbon has simply not wired it up: `purchase_order_ids`
 * (an array of Ramp PO uuids) is documented and writable on both
 * `POST /developer/v1/bills/drafts` and `PATCH /developer/v1/bills/drafts/{id}`
 * ("Unique identifiers of the purchase orders to match this bill to"), as are
 * `line_items[].purchase_order_line_item_id` and
 * `inventory_line_items[].purchase_order_line_item_id`. Sending them is a
 * follow-up. An earlier probe reported the field absent and was wrong twice
 * over: `purchase_order_id` SINGULAR is not a field on that endpoint at all (an
 * unknown key, silently ignored), and `GET /developer/v1/bills/drafts/{id}`
 * exposes no purchase-order key, so reading a draft back could never have
 * detected storage either way — those fields are readable only on a SUBMITTED
 * bill. Nor does Ramp demonstrably match by itself: sandbox PO000101 (unarchived,
 * `billing_status: OPEN`, `bill_ids: []`) and draft AP000009 shared a vendor and
 * a total and stayed unmatched. Either route needs the order to still EXIST,
 * which is why a Completed order is no longer archived (see
 * `SPEND_SETTLED_PURCHASE_ORDER_STATUSES`).
 */
export function buildBillMemo(local: {
  readableId: string;
  purchaseOrderReadableIds?: string[];
}): string {
  const orders = (local.purchaseOrderReadableIds ?? []).filter(Boolean);
  return orders.length > 0
    ? `${local.readableId} · ${orders.join(", ")}`
    : local.readableId;
}

export class RampBillSyncer extends RampPushOnlyEntitySyncer<
  SpendBillSource,
  RampBillRemote,
  never
> {
  protected get pushOnlyEntityLabel(): string {
    return "Bills";
  }

  protected async fetchLocal(id: string): Promise<SpendBillSource | null> {
    return (await this.fetchLocalBatch([id])).get(id) ?? null;
  }

  protected async fetchLocalBatch(
    ids: string[]
  ): Promise<Map<string, SpendBillSource>> {
    return loadBillPushSource(this.database, this.companyId, ids);
  }

  protected async shouldSync(context: {
    entityId: string;
    localEntity?: SpendBillSource;
  }): Promise<boolean | string> {
    const invoice = context.localEntity;
    if (!invoice) return "purchase invoice not found";

    if (!isPushableInvoiceStatus(invoice.status)) {
      return `purchase invoice is ${invoice.status} — only open payables hand off to Ramp`;
    }

    if (invoice.isEmployeeParty) {
      return "purchase invoice belongs to an Employee supplier — reimbursements are Ramp's own";
    }

    /**
     * Already handed off — stop HERE, not in `upsertRemote`.
     *
     * The push is create-once (see the header), and `upsertRemote` short-circuits
     * on the mapping. But the base class calls `mapToRemote` FIRST, and that
     * resolves-or-creates a Ramp spend vendor and replays the posted journal — so
     * any `updatedAt` bump on a bill Ramp already has re-ran all of it and could
     * fail the operation with `UNMAPPED_ACCOUNTS` (or a vendor-create rejection)
     * for a bill that needed no work at all, putting a red row in Sync Activity
     * that no action can clear. `isFirstSync` cannot answer this: the BATCH path
     * hard-codes it to `true` for performance, so the mapping is read here.
     */
    const existing = await this.getRemoteId(context.entityId);
    if (existing) {
      return `purchase invoice was already handed off to Ramp as draft bill ${existing} — a draft cannot be re-created or updated`;
    }

    return true;
  }

  protected async mapToRemote(local: SpendBillSource): Promise<RampBillRemote> {
    // A bill REQUIRES a vendor_id, unlike a PO where it is optional — so Ramp's
    // own rejection is the only actionable diagnosis and must not be swallowed.
    const vendorId = await resolveOrCreateRampSpendVendor(
      this.mappingService,
      this.ramp,
      local.supplier,
      this.companyId,
      undefined,
      { surfaceCreateError: true }
    );
    if (!vendorId) {
      throw new Error(
        // Name the supplier and the field that is actually missing. The old
        // message listed all three requirements without saying which one was
        // absent or whose supplier it was, so acting on it meant reading the
        // database.
        `Cannot push invoice ${local.readableId} to Ramp: ${describeMissingVendorFields(local.supplier)}`
      );
    }

    /**
     * Whose coding options these lines address.
     *
     * When another system holds Ramp's accounting seat it published the options,
     * so the mappings to read are ITS (`rillet`'s account → its external id), and
     * the external id is what Ramp knows the option by. Reading Ramp's own
     * mappings there finds nothing — Carbon never pushed a chart of accounts in
     * that mode — so every line degraded to uncoded and the bill landed needing
     * manual coding before the seat-holder could post it.
     */
    const delegatedTo = this.rampProvider.codingIdentityIntegrationId;
    const pushed = await loadPushedCoding(
      this.mappingService,
      delegatedTo ?? "ramp",
      { useExternalIds: Boolean(delegatedTo) }
    );
    const { lines, currencyCode } = await loadBillPushLines(this.database, {
      companyId: this.companyId,
      billId: local.id,
      pushed
    });

    // `invoice_number` stays the SUPPLIER's reference whenever there is one —
    // that is the number an AP clerk matches against the paper, and Carbon's own
    // id in that field would be wrong. But then nothing on the Ramp bill named
    // the Carbon invoice at all: a bill showing only `CEX-Q-4471` could not be
    // traced back to `AP000008` without querying the database. `memo` carries
    // it, alongside the orders the invoice bills (see `buildBillMemo`) — a human
    // trace, not Ramp's own `purchase_order_ids` link, which is writable and
    // simply not wired up yet.
    const invoiceNumber =
      (local.supplierReference ?? "").trim() || local.readableId;
    const memo = buildBillMemo(local);

    return {
      vendor_id: vendorId,
      invoice_number: invoiceNumber,
      invoice_currency: currencyCode,
      ...(local.dateIssued ? { issued_at: local.dateIssued } : {}),
      ...(local.dateDue ? { due_at: local.dateDue } : {}),
      ...(memo ? { memo } : {}),
      remote_id: local.id,
      line_items: lines.map((line) => ({
        memo: line.memo,
        amount: line.amount,
        accounting_field_selections: buildLineCodingSelections(
          {
            accountId: line.accountId,
            costCenterId: line.costCenterId,
            projectId: line.projectId
          },
          pushed
        )
      }))
    };
  }

  protected async upsertRemote(
    data: RampBillRemote,
    localId: string
  ): Promise<string> {
    // Create-once — see the header. `shouldSync` already refuses a mapped bill
    // before `mapToRemote` runs; this stays as a belt-and-braces no-op for any
    // caller that reaches `upsertRemote` by another route.
    const existing = await this.getRemoteId(localId);
    if (existing) return existing;

    const created = (await this.ramp.createDraftBill(
      data,
      buildRampIdempotencyKey({
        companyId: this.companyId,
        operation: "createDraftBill",
        scope: localId
      })
    )) as { id?: string } | null;

    const draftId = created?.id ?? null;
    if (!draftId) {
      throw new Error(
        `Ramp did not return a draft-bill id for invoice ${data.invoice_number}`
      );
    }

    return draftId;
  }
}
