// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The inputs several checks share, each as a named loader a check declares.
// A loader that already takes only `root` (`loadServerFiles`, `loadDbTableColumns`,
// `loadTestFiles`, …) is declared as it is and is not repeated here.

import { loadSqlFiles, migrationsDir } from "./migrations";
import { loadModules, modulesDir } from "./modules";
import { loadPluginFindings } from "./oxlint";
import { readableSql } from "./sql";
import {
  loadTypescriptFiles,
  REQUEST_HANDLING_ROOTS,
  ROUTE_ROOTS
} from "./typescript";

/** Every migration, in apply order; `file` is the bare file name. */
export const migrations = (root: string) =>
  readableSql(loadSqlFiles(migrationsDir(root)));

/** The app and shared-package TypeScript, client and server. */
export const typescript = (root: string) => loadTypescriptFiles(root);

/** The TypeScript of every app and package that handles a request. */
export const requestHandlingTypescript = (root: string) =>
  loadTypescriptFiles(root, REQUEST_HANDLING_ROOTS);

/** The route trees of every React Router app. */
export const routeTypescript = (root: string) =>
  loadTypescriptFiles(root, ROUTE_ROOTS);

/** The ERP's module folders. */
export const erpModules = (root: string) => loadModules(modulesDir(root));

/** What the `carbon` oxlint plugin reports for the ERP routes (`oxlint-plugins/carbon.mjs`). */
export const pluginFindings = (root: string) =>
  loadPluginFindings(root, ["apps/erp/app/routes"]);
