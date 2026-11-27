// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  REGISTRY_HELPERS_DIR,
  renderRegistryHelpers
} from "@carbon/database/authz-registry-sql";

/** The registry helper files `registry-helpers-fresh` compares; a missing one has no contents. */
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

/** What `renderRegistryHelpers()` renders, beside what the repo holds for each file. */
export function loadRegistryHelpers(root: string) {
  const rendered = renderRegistryHelpers();
  return {
    rendered,
    files: loadRegistryHelperFiles(
      root,
      rendered.map((helper) => helper.name)
    )
  };
}
