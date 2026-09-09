// Node-side re-export of the edge-runtime batch-time-split module (same pattern
// as precision.ts / sampling.ts). The source lives under supabase/functions/
// because the edge runtime only mounts that tree; it is dependency-free pure TS.
// Re-exporting rather than duplicating keeps ONE source of truth — the Deno copy
// and the Node/browser side can never drift.
export * from "../../database/supabase/functions/shared/batch-time-split.ts";
