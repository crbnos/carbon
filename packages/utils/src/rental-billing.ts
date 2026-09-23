// Node-side re-export of the edge-runtime rental billing math (same pattern
// as ./revenue-schedule.ts and ./precision.ts). The source lives under
// supabase/functions/ because the edge runtime only mounts that tree; it is
// dependency-free pure TS.
export * from "../../database/supabase/functions/shared/rental-billing.ts";
