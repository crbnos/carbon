// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Node-side re-export of the edge-runtime batch-pick-split module (same
// pattern as precision.ts / batch-time-split.ts). The source lives under
// supabase/functions/ because the edge runtime only mounts that tree.
export * from "../../database/supabase/functions/shared/batch-pick-split.ts";
