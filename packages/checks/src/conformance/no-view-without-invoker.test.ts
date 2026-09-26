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

  it("handles a column list before the option list", () => {
    const sql = 'CREATE VIEW "x" ("a", "b") AS SELECT 1, 2;';
    expect(noViewWithoutInvoker.scan("p.sql", sql)).toHaveLength(1);
  });

  it("ignores a view in a block comment", () => {
    const sql = '/*\nCREATE OR REPLACE VIEW "x" AS\n*/\nSELECT 1;';
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
});
