// Node-side re-export of the edge-runtime straight-line schedule math (same
// pattern as ./precision.ts). The source lives under supabase/functions/ because
// the edge runtime only mounts that tree; it is dependency-free pure TS.
export * from "../../database/supabase/functions/shared/revenue-schedule.ts";
