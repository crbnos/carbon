// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { noViewWithoutInvoker } from "./no-view-without-invoker";

describe("noViewWithoutInvoker", () => {
  it("flags a CREATE OR REPLACE VIEW with no option list", () => {
    const sql =
      'SELECT 1;\nCREATE OR REPLACE VIEW "openJobMaterialLines" AS (\n  SELECT 1\n);';
    const v = noViewWithoutInvoker.scan("p.sql", sql);
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(2);
    expect(v[0]?.message).toContain('"openJobMaterialLines"');
  });

  it("flags a view whose option list omits security_invoker", () => {
    const sql = 'CREATE VIEW "x" WITH (check_option = local) AS SELECT 1;';
    expect(noViewWithoutInvoker.scan("p.sql", sql)).toHaveLength(1);
  });

  it("allows security_invoker in any casing and spacing", () => {
    const sql = [
      'CREATE OR REPLACE VIEW "a" WITH (security_invoker = true) AS SELECT 1;',
      'CREATE OR REPLACE VIEW "b" WITH(SECURITY_INVOKER=true) AS SELECT 1;',
      'CREATE VIEW public."c"\nWITH (security_invoker=true)\nAS\nSELECT 1;'
    ].join("\n");
    expect(noViewWithoutInvoker.scan("p.sql", sql)).toHaveLength(0);
  });

  it("allows an explicit owner-rights view", () => {
    const sql =
      'CREATE VIEW "modules" WITH (security_invoker = false) AS SELECT 1;';
    expect(noViewWithoutInvoker.scan("p.sql", sql)).toHaveLength(0);
  });

  it("ignores materialized views", () => {
    const sql = 'CREATE MATERIALIZED VIEW "itemLedgerSnapshot" AS SELECT 1;';
    expect(noViewWithoutInvoker.scan("p.sql", sql)).toHaveLength(0);
  });

  it("ignores a view in a comment", () => {
    const sql = '-- CREATE OR REPLACE VIEW "x" AS\nSELECT 1;';
    expect(noViewWithoutInvoker.scan("p.sql", sql)).toHaveLength(0);
  });

  it("keeps line numbers after a block comment", () => {
    const sql = '/* one\ntwo */\nCREATE VIEW "x" AS SELECT 1;';
    expect(noViewWithoutInvoker.scan("p.sql", sql)[0]?.line).toBe(3);
  });

  it("flags ALTER VIEW … RESET (security_invoker)", () => {
    const sql = 'ALTER VIEW "openJobMaterialLines" RESET (security_invoker);';
    const v = noViewWithoutInvoker.scan("p.sql", sql);
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain("RESET");
  });

  it("allows ALTER VIEW … SET (security_invoker = true)", () => {
    const sql = 'ALTER VIEW "x" SET (security_invoker = true);';
    expect(noViewWithoutInvoker.scan("p.sql", sql)).toHaveLength(0);
  });

  it("ignores a view named in a string or a function body", () => {
    const sql = [
      'COMMENT ON TABLE "job" IS \'CREATE VIEW "x" AS SELECT 1\';',
      "CREATE FUNCTION f() RETURNS void LANGUAGE sql AS $$ SELECT 'CREATE VIEW \"x\" AS' $$;"
    ].join("\n");
    expect(noViewWithoutInvoker.scan("p.sql", sql)).toHaveLength(0);
  });
  it("allows ALTER VIEW … RESET of another option", () => {
    const sql = 'ALTER VIEW "x" RESET (check_option);';
    expect(noViewWithoutInvoker.scan("p.sql", sql)).toHaveLength(0);
  });
});
