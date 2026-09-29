// Node-side re-export of the helpers the edge functions share (the same bridge
// pattern as datetime.ts / sequence.ts), for @carbon/operations. Transitional:
// one copy lives under supabase/functions until the edge functions are gone,
// when these files move into the packages that use them.

export { toJson, toJsonColumns } from "../supabase/functions/lib/json.ts";
export * from "../supabase/functions/lib/storage-units.ts";
export {
  credit,
  debit,
  journalReference,
  type TrackedEntityAttributes
} from "../supabase/functions/lib/utils.ts";
export * from "../supabase/functions/shared/accounting-posting.ts";
export * from "../supabase/functions/shared/build-memo-journal.ts";
export * from "../supabase/functions/shared/build-payment-journal.ts";
export { calculateCOGS } from "../supabase/functions/shared/calculate-cogs.ts";
export {
  settleQuantity,
  statusAfterQuantityChange
} from "../supabase/functions/shared/entity-drain.ts";
export * from "../supabase/functions/shared/get-accounting-period.ts";
export * from "../supabase/functions/shared/get-posting-group.ts";
export * from "../supabase/functions/shared/payment-funding.ts";
export {
  type AdjustmentItemCost,
  bookAdjustment,
  createAdjustmentJournal
} from "../supabase/functions/shared/post-adjustment.ts";
export { resolveTrackedEntityBin } from "../supabase/functions/shared/resolve-tracked-entity-bin.ts";
export { getRemainingQuantityToInvoice } from "../supabase/functions/shared/short-close.ts";
export { toTiptapDoc } from "../supabase/functions/shared/tiptap.ts";
