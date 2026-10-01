// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Node-side re-export of the edge-runtime supersession-pick helper. Same bridge pattern
// as client.ts / scheduling.ts: one copy lives under supabase/functions/lib
// (imported by Deno edge functions), re-exported here for Node consumers
// (@carbon/planning, the ERP app, @carbon/jobs).
export * from "../supabase/functions/lib/supersession-pick.ts";
