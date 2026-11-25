// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

// The inputs several checks share, each as a named loader for `repo.read`.
// A loader that already takes only `root` (`loadServerFiles`, `loadDbTableColumns`,
// `loadTestFiles`, …) is passed to `repo.read` as it is and is not repeated here.

import { loadPluginFindings } from "./biome";
import { loadSqlFiles, migrationsDir } from "./migrations";
import { loadModules, modulesDir } from "./modules";
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

/** What the Biome plugins report for the ERP routes (`biome-plugins/*.grit`). */
export const pluginFindings = (root: string) =>
  loadPluginFindings(root, ["apps/erp/app/routes"]);
