// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { REGISTRY_HELPERS_DIR } from "@carbon/database/authz-registry-sql";
import { describe, expect, it } from "vitest";
import { registryHelpersFresh } from "./registry-helpers-fresh";

const rendered = [
  { name: "util.module_pages.sql", sql: "-- pages v2\n" },
  { name: "util.page_max_level.sql", sql: "-- levels\n" }
];
const at = (name: string) => `${REGISTRY_HELPERS_DIR}/${name}`;

const findStale = (files: { file: string; contents: string | undefined }[]) =>
  registryHelpersFresh.find({ helpers: { rendered, files } });

describe("registryHelpersFresh", () => {
  it("passes files that hold what the registry renders", () => {
    expect(
      findStale([
        { file: at("util.module_pages.sql"), contents: "-- pages v2\n" },
        { file: at("util.page_max_level.sql"), contents: "-- levels\n" }
      ])
    ).toEqual([]);
  });

  it("fails a stale file and names the sync command", () => {
    const violations = findStale([
      { file: at("util.module_pages.sql"), contents: "-- pages v1\n" },
      { file: at("util.page_max_level.sql"), contents: "-- levels\n" }
    ]);
    expect(violations).toEqual([
      {
        file: at("util.module_pages.sql"),
        line: 0,
        snippet: "util.module_pages.sql",
        message:
          "util.module_pages.sql is stale (it differs from the registry): run pnpm --filter @carbon/database authz sync"
      }
    ]);
  });

  it("fails a missing file", () => {
    const violations = findStale([
      { file: at("util.module_pages.sql"), contents: "-- pages v2\n" },
      { file: at("util.page_max_level.sql"), contents: undefined }
    ]);
    expect(violations.map((v) => [v.file, v.message])).toEqual([
      [
        at("util.page_max_level.sql"),
        "util.page_max_level.sql is missing: run pnpm --filter @carbon/database authz sync"
      ]
    ]);
  });
});
