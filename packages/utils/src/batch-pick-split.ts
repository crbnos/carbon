// Node-side re-export of the edge-runtime batch-pick-split module (same
// pattern as precision.ts / batch-time-split.ts). The source lives under
// supabase/functions/ because the edge runtime only mounts that tree.
export * from "../../database/supabase/functions/shared/batch-pick-split.ts";
