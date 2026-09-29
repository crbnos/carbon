// Node-side re-export of the posting helpers the edge functions share (the same
// bridge pattern as datetime.ts / sequence.ts), for @carbon/operations. One copy
// lives under supabase/functions until the edge functions are gone.

export { toJson } from "../supabase/functions/lib/json.ts";
export {
  credit,
  debit,
  journalReference
} from "../supabase/functions/lib/utils.ts";
export { statusAfterQuantityChange } from "../supabase/functions/shared/entity-drain.ts";
export * from "../supabase/functions/shared/get-accounting-period.ts";
export * from "../supabase/functions/shared/get-posting-group.ts";
export {
  type AdjustmentItemCost,
  bookAdjustment,
  createAdjustmentJournal
} from "../supabase/functions/shared/post-adjustment.ts";
export { getRemainingQuantityToInvoice } from "../supabase/functions/shared/short-close.ts";
