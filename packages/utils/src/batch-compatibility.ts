// Node-side re-export of the edge-runtime batch-compatibility module (same
// pattern as precision.ts / batch-time-split.ts). The source lives under
// supabase/functions/ because the edge runtime only mounts that tree; it is
// dependency-free pure TS. Re-exporting rather than duplicating keeps ONE source
// of truth — the Deno copy and the Node/browser side can never drift.
export * from "../../database/supabase/functions/shared/batch-compatibility.ts";
