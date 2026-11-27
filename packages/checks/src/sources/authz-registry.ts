// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REGISTRY_HELPERS_DIR } from "@carbon/database/authz-registry-sql";

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
