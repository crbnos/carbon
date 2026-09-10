// Node-side re-export of the edge-runtime mrp-engine helper. Same bridge pattern
// as client.ts / scheduling.ts: one copy lives under supabase/functions/lib
// (imported by Deno edge functions), re-exported here for Node consumers
// (@carbon/ee/planning, the ERP app, @carbon/jobs).
export * from "../supabase/functions/lib/mrp-engine.ts";
