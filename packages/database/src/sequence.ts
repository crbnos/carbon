// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Node-side re-export keeps document-number allocation in one place;
// duplicate implementations silently diverge and mint duplicate sequence IDs.
export { getNextSequence } from "../supabase/functions/shared/get-next-sequence.ts";
