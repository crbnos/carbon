// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  createDatabaseSql,
  databaseGrantsSql,
  dropDatabaseSql
} from "./shared-db.js";

describe("worktree database SQL", () => {
  it("gives the clone the owner and grants of the image's postgres database", () => {
    const sql = databaseGrantsSql("wt_carbon_x");
    expect(sql).toContain('ALTER DATABASE "wt_carbon_x" OWNER TO postgres');
    expect(sql).toContain('GRANT ALL ON DATABASE "wt_carbon_x" TO postgres');
  });

  it("clones carbon_template", () => {
    expect(createDatabaseSql("wt_carbon_x")).toBe(
      'CREATE DATABASE "wt_carbon_x" TEMPLATE carbon_template'
    );
  });

  it("drops with FORCE, so open connections don't block it", () => {
    expect(dropDatabaseSql("wt_carbon_x")).toBe(
      'DROP DATABASE IF EXISTS "wt_carbon_x" WITH (FORCE)'
    );
  });

  it("refuses a name that is not a worktree database", () => {
    for (const bad of ["postgres", "carbon_template", 'wt_x"; DROP', "WT_X"]) {
      expect(() => createDatabaseSql(bad)).toThrow(/not a worktree database/);
      expect(() => dropDatabaseSql(bad)).toThrow(/not a worktree database/);
      expect(() => databaseGrantsSql(bad)).toThrow(/not a worktree database/);
    }
  });
});
