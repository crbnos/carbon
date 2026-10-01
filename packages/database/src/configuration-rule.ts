// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// Node/browser re-export of the configuration-rule runner the edge runtime uses, so the rule
// editor and get-method run rules in the same QuickJS sandbox. Its npm dependencies are pinned
// in both this package.json and supabase/functions/deno.json — keep the versions identical.
export * from "../supabase/functions/shared/configuration-rule.ts";
