// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { REGISTRY_HELPERS_DIR } from "@carbon/database/authz-registry-sql";
import type { SourceFile } from "../check";
import { loadSqlFiles } from "./migrations";

// The managed functions are authored only as files and applied by `authz sync`
// after migrations: the RLS helpers, the event-system functions, and the table
// handlers. Each set is checked only in migrations dated from its takeover.

/** The migration from which RLS policies and helpers are authored as files. */
export const MANIFEST_SINCE = "20260927000000";

/** The migration that took over the event-system functions. */
const EVENT_SYSTEM_SINCE = "20261002114954";

/**
 * The migration that took over the table handlers (interceptors and statement
 * handlers) and the event triggers that attach them.
 */
export const ATTACHMENTS_SINCE = "20261004194527";

/** The directories of managed function files, and the migration each set is checked from. */
export const MANAGED_FUNCTION_SETS = [
  { dir: REGISTRY_HELPERS_DIR, since: MANIFEST_SINCE },
  {
    dir: "packages/database/src/event-system/functions",
    since: EVENT_SYSTEM_SINCE
  },
  {
    dir: "packages/database/src/event-system/handlers",
    since: ATTACHMENTS_SINCE
  }
];

/** `file` is `<name>.sql` for public, `<schema>.<name>.sql` otherwise. */
export type ManagedFunction = {
  schema: string;
  name: string;
  /** Repo-relative path of the file that defines it. */
  file: string;
  since: string;
};

/**
 * The managed functions: one `<name>.sql` (or `<schema>.<name>.sql`) file each.
 * The list is read from the directories, so it cannot drift from the files.
 */
export function loadManagedFunctions(root: string): ManagedFunction[] {
  return MANAGED_FUNCTION_SETS.flatMap(({ dir, since }) =>
    readdirSync(join(root, dir))
      .filter((file) => file.endsWith(".sql"))
      .map((file) => {
        const [first = "", second] = file.replace(/\.sql$/, "").split(".");
        return {
          schema: second ? first : "public",
          name: second ?? first,
          file: `${dir}/${file}`,
          since
        };
      })
  );
}

/** The managed function files, read with their repo paths. */
export function loadManagedFunctionFiles(root: string): SourceFile[] {
  return MANAGED_FUNCTION_SETS.flatMap(({ dir }) =>
    loadSqlFiles(join(root, dir)).map(({ file, contents }) => ({
      file: `${dir}/${file}`,
      contents
    }))
  );
}
