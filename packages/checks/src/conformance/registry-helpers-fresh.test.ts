// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { REGISTRY_HELPERS_DIR } from "@carbon/database/authz-registry-sql";
import { describe, expect, it } from "vitest";
import {
  findStaleRegistryHelpers,
  REGISTRY_HELPERS_FIX
} from "./registry-helpers-fresh";

const rendered = [
  { name: "util.module_pages.sql", sql: "-- pages v2\n" },
  { name: "util.page_max_level.sql", sql: "-- levels\n" }
];
const at = (name: string) => `${REGISTRY_HELPERS_DIR}/${name}`;

describe("findStaleRegistryHelpers", () => {
  it("passes files that hold what the registry renders", () => {
    expect(
      findStaleRegistryHelpers(rendered, [
        { file: at("util.module_pages.sql"), contents: "-- pages v2\n" },
        { file: at("util.page_max_level.sql"), contents: "-- levels\n" }
      ])
    ).toEqual([]);
  });

  it("fails a stale file and names the sync command", () => {
    const violations = findStaleRegistryHelpers(rendered, [
      { file: at("util.module_pages.sql"), contents: "-- pages v1\n" },
      { file: at("util.page_max_level.sql"), contents: "-- levels\n" }
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe(at("util.module_pages.sql"));
    expect(violations[0]?.message).toContain("stale");
    expect(violations[0]?.message).toContain(REGISTRY_HELPERS_FIX);
  });

  it("fails a missing file", () => {
    const violations = findStaleRegistryHelpers(rendered, [
      { file: at("util.module_pages.sql"), contents: "-- pages v2\n" },
      { file: at("util.page_max_level.sql"), contents: undefined }
    ]);
    expect(violations.map((v) => v.file)).toEqual([
      at("util.page_max_level.sql")
    ]);
    expect(violations[0]?.message).toContain("missing");
  });
});
