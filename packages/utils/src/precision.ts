// Node-side re-export of the edge-runtime precision module (same pattern as
// packages/database/src/sampling.ts). The source lives under supabase/functions/
// because the edge runtime only mounts that tree; it is dependency-free pure TS.
export * from "../../database/supabase/functions/shared/precision.ts";
