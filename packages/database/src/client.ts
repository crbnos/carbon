// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// This is a barrel file that re-exports everything from database.ts
// As Supabase functions have limitations on module resolution,
// we directly re-export from the database.ts file here.
export * from "../supabase/functions/lib/postgres/index.ts";
