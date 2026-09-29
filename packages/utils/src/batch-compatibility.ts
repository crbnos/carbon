// Node-side re-export of the batch-compatibility module (same pattern as
// precision.ts / batch-time-split.ts). The source lives under
// supabase/functions/shared; it is dependency-free pure TS. Re-exporting rather
// than duplicating keeps ONE source of truth.
export * from "../../database/supabase/functions/shared/batch-compatibility.ts";
