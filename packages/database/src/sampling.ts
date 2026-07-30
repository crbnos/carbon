// Node-side re-export of the edge-runtime sampling engine (same pattern as
// client.ts). The engine is pure TS (Z1.4 / ISO 2859-1 tables + resolvers), so
// ERP, MES, and edge functions can all share the single copy that post-receipt
// already uses.
export * from "../supabase/functions/shared/sampling-engine.ts";
