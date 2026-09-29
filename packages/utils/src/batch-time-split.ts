// Node-side re-export of the batch-time-split module (same pattern as
// precision.ts / sampling.ts). The source lives under supabase/functions/shared;
// it is dependency-free pure TS. Re-exporting rather than duplicating keeps ONE
// source of truth.
export * from "../../database/supabase/functions/shared/batch-time-split.ts";
