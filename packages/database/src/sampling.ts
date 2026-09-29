// Node-side re-export of the sampling engine under supabase/functions/shared
// (same pattern as client.ts). The engine is pure TS (Z1.4 / ISO 2859-1 tables
// + resolvers), so ERP, MES, and the server functions all share the single copy
// that post-receipt uses.
export * from "../supabase/functions/shared/sampling-engine.ts";
