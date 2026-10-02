// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Node-side re-export of the edge-runtime straight-line schedule math (same
// pattern as ./precision.ts). The source lives under supabase/functions/ because
// the edge runtime only mounts that tree; it is dependency-free pure TS.
export * from "../../database/supabase/functions/shared/revenue-schedule.ts";
