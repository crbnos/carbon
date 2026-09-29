// Node-side re-export of the fetch-all helper. Same bridge pattern as
// client.ts: one copy lives under supabase/functions/lib, re-exported here for
// Node consumers (@carbon/planning, the ERP app, @carbon/jobs).
export * from "../supabase/functions/lib/fetch-all.ts";
