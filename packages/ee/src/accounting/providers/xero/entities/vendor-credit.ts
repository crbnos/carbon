import { type MemoDirection, XeroCreditNoteSyncerBase } from "./credit-memo";

/**
 * Supplier credits (`vendorCredit`): a supplier + **Debit** memo reduces AP and
 * is pushed as a Xero `ACCPAYCREDIT`. A supplier + Credit memo increases AP and
 * is skipped (XERO_MEMO_INCREASER_SKIP_REASON).
 *
 * The whole credit-note mechanism — line building, AUTHORISED create, the
 * separate additive allocation call, the `CreditNoteNumber` recovery read —
 * lives in `./credit-memo` as `XeroCreditNoteSyncerBase`; the two families
 * differ only in the five fields below. Note `ACCPAYCREDIT` has no `Reference`
 * field, which the base handles by only emitting one for `ACCRECCREDIT`.
 */
export class VendorCreditSyncer extends XeroCreditNoteSyncerBase {
  protected readonly creditNoteType = "ACCPAYCREDIT" as const;
  protected readonly party = "supplier" as const;
  protected readonly decreasingDirection: MemoDirection = "Debit";
  protected readonly contactEntityType = "vendor" as const;
  protected readonly documentEntityType = "bill" as const;
  protected readonly documentLabel = "bill";
}
