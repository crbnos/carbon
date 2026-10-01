// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { generateDatabaseTypes } from "./lib/generate-db-types";
import { loadDotEnv } from "./lib/local-script-config";

try {
  loadDotEnv();
  generateDatabaseTypes(process.env.SUPABASE_DB_URL);
  process.stdout.write("Database types refreshed in both output files.\n");
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Database type generation failed."}\n`
  );
  process.exitCode = 1;
}
