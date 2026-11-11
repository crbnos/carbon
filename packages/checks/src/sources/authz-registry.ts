// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REGISTRY_HELPERS_DIR } from "@carbon/database/authz-registry-sql";
import type { SourceFile } from "../check";
import { MOVED_TABLES_MIGRATION } from "../conformance/moved-tables-covered";
import { ERP_ROUTES_DIR } from "../conformance/route-maps-to-page";

/** The registry helper files `findStaleRegistryHelpers` compares; a missing one has no contents. */
export function loadRegistryHelperFiles(
  root: string,
  names: readonly string[]
): { file: string; contents: string | undefined }[] {
  return names.map((name) => {
    const file = `${REGISTRY_HELPERS_DIR}/${name}`;
    const path = join(root, file);
    return {
      file,
      contents: existsSync(path) ? readFileSync(path, "utf-8") : undefined
    };
  });
}

/** The migration `findMovedTableGaps` reads. */
export function loadMovedTablesMigration(root: string): SourceFile {
  return {
    file: MOVED_TABLES_MIGRATION,
    contents: readFileSync(join(root, MOVED_TABLES_MIGRATION), "utf-8")
  };
}

/**
 * The ERP route files under `x+` that `findRoutePageGaps` maps, relative to
 * `x+`: the files remix-flat-routes builds routes from (`apps/erp/app/routes.ts`
 * ignores dot folders, `__` names and `.server`/`.client`/`.test` files).
 */
export function loadErpRouteFiles(root: string): string[] {
  return (
    readdirSync(join(root, ERP_ROUTES_DIR), { recursive: true }) as string[]
  )
    .map((file) => file.split("\\").join("/"))
    .filter(
      (file) =>
        /\.(tsx?|jsx?)$/.test(file) &&
        !file.split("/").some((part) => part.startsWith(".")) &&
        !/(^|\/)__|\.(server|client|test)\./.test(file)
    )
    .sort();
}
