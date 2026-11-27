// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The plain sets of files checks read, each as a named loader a check declares.
// A loader that already takes only `root` (`loadServerFiles`, `loadDbTableColumns`,
// `loadTestFiles`, …) is declared as it is and is not repeated here.

import { loadSqlFiles, migrationsDir } from "./migrations";
import { readableSql } from "./sql";
import { loadTypescriptFiles } from "./typescript";

/** Every migration, in apply order; `file` is the bare file name. */
export const migrations = (root: string) =>
  readableSql(loadSqlFiles(migrationsDir(root)));

/** The app and shared-package TypeScript, client and server. */
export const typescript = (root: string) => loadTypescriptFiles(root);

/** The TypeScript of every app and package that handles a request. */
export const requestHandlingTypescript = (root: string) =>
  loadTypescriptFiles(root, [
    "apps/erp/app",
    "apps/mes/app",
    "apps/academy/app",
    "apps/starter/app",
    "packages/auth/src",
    "packages/database/supabase/functions",
    "packages/ee/src",
    "packages/jobs/src",
    "packages/lib/src",
    "packages/utils/src"
  ]);

/** The route trees of every React Router app. */
export const routeTypescript = (root: string) =>
  loadTypescriptFiles(root, [
    "apps/erp/app/routes",
    "apps/mes/app/routes",
    "apps/academy/app/routes",
    "apps/starter/app/routes"
  ]);
