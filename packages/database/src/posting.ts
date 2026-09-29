// Node-side re-export of the shared posting helpers under supabase/functions
// (the same bridge pattern as datetime.ts / sequence.ts), for
// @carbon/server-functions. Transitional: one copy lives under
// supabase/functions until these files move into the packages that use them.

export { toJson, toJsonColumns } from "../supabase/functions/lib/json.ts";
export * from "../supabase/functions/lib/storage-units.ts";
export { journalReference } from "../supabase/functions/lib/utils.ts";
export * from "../supabase/functions/shared/build-memo-journal.ts";
export * from "../supabase/functions/shared/build-payment-journal.ts";
export { calculateCOGS } from "../supabase/functions/shared/calculate-cogs.ts";
export * from "../supabase/functions/shared/get-accounting-period.ts";
export * from "../supabase/functions/shared/get-posting-group.ts";
export * from "../supabase/functions/shared/plan-adjustment.ts";
export {
  type AdjustmentItemCost,
  bookAdjustment,
  createAdjustmentJournal,
  loadOpenCostLayers
} from "../supabase/functions/shared/post-adjustment.ts";
