// Node-side re-export of the edge-runtime lessor lease math (same pattern as
// ./revenue-schedule.ts and ./rental-billing.ts). The source lives under
// supabase/functions/ because the edge runtime only mounts that tree; it is
// dependency-free pure TS.
export * from "../../database/supabase/functions/shared/lessor-lease.ts";
