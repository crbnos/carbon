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
 * Two facts, one field, because Ramp gives us one field. `invoice_number` is
 * reserved for the SUPPLIER's reference, and a draft bill has no writable
 * purchase-order link — verified live 2026-09-27: `POST /bills/drafts` accepts
 * both `purchase_order_id` and `purchase_order_ids` with a 201 and stores
 * neither, and reading the draft back shows no purchase-related key at all.
 * Ramp performs that match itself, and only while the order still exists (which
 * is why a Completed order is no longer archived — see
 * `SPEND_SETTLED_PURCHASE_ORDER_STATUSES`).
 *
 * So the memo is not decoration and not a substitute for the match: it is the
 * only thing Carbon can put on the bill that tells a person reading it in Ramp
 * which Carbon invoice this is and which orders it settles. It is deliberately
 * bare ids rather than a sentence — someone searching Ramp for `AP000008` or
 * `PO000018` should find this bill.
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
    // it, alongside the orders the invoice bills, because Ramp does not expose a
    // writable purchase-order field on a draft (see `buildBillMemo`).
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
    // Create-once — see the header.
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
