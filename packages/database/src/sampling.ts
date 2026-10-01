// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Node-side re-export of the edge-runtime sampling engine (same pattern as
// client.ts). The engine is pure TS (Z1.4 / ISO 2859-1 tables + resolvers), so
// ERP, MES, and edge functions can all share the single copy that post-receipt
// already uses.
export * from "../supabase/functions/shared/sampling-engine.ts";
