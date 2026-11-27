// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  loadManagedFunctionFiles,
  loadManagedFunctions,
  MANIFEST_SINCE
} from "./managed-functions";
import { repoRoot } from "./migrations";

describe("loadManagedFunctions", () => {
  it("names each function by its file, in public unless the file names a schema", () => {
    const functions = loadManagedFunctions(repoRoot());
    expect(
      functions.find((f) => f.name === "get_companies_with_employee_permission")
    ).toEqual({
      schema: "public",
      name: "get_companies_with_employee_permission",
      file: "packages/database/src/authz/helpers/get_companies_with_employee_permission.sql",
      since: MANIFEST_SINCE
    });
    for (const f of functions.filter((f) => f.schema !== "public")) {
      expect(f.file.endsWith(`/${f.schema}.${f.name}.sql`)).toBe(true);
    }
  });

  it("reads the same files the list names", () => {
    const root = repoRoot();
    expect(
      loadManagedFunctionFiles(root)
        .map((f) => f.file)
        .sort()
    ).toEqual(
      loadManagedFunctions(root)
        .map((f) => f.file)
        .sort()
    );
  });
});
