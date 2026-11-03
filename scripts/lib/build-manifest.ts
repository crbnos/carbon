// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import * as path from "path";
import type { ManifestEntry } from "@carbon/api";
import { Project } from "ts-morph";
import { linkIdLookups } from "./id-lookups";
import { buildServiceFnTools, routerLeaves } from "./service-fn-metadata";

/**
 * The published manifest: every `@mcp` service function the ERP router
 * reaches, with each id input's lookup. `generate-mcp` and `check-manifest`
 * both build it here, so the digest they compare cannot differ by construction.
 */
export async function buildManifest(): Promise<ManifestEntry[]> {
  const project = new Project({
    tsConfigFilePath: path.resolve(__dirname, "../../apps/erp/tsconfig.json"),
    skipAddingFilesFromTsConfig: true
  });
  const leaves = routerLeaves(project);
  const tools = buildServiceFnTools(project, undefined, leaves);
  await linkIdLookups(tools, leaves);
  return tools;
}
