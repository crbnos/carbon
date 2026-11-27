// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { GENERATED_AUTHZ_MIGRATION } from "../../sources/migrations";
import { noLegacyRls } from "./no-legacy-rls";

describe("noLegacyRls", () => {
  it("flags has_company_permission(...)", () => {
    const sql =
      'CREATE POLICY "p" ON "t" USING (has_company_permission(\'view\', "companyId"));';
    const v = noLegacyRls.scan("p.sql", sql);
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(1);
  });

  it("allows the current get_companies_with_employee_permission helper", () => {
    const sql =
      'CREATE POLICY "p" ON "t" USING ("companyId" = ANY ((SELECT get_companies_with_employee_permission(\'view\'))::text[]));';
    const v = noLegacyRls.scan("p.sql", sql);
    expect(v).toHaveLength(0);
  });

  it("leaves the helper's own definition and a comment alone", () => {
    const sql = [
      "-- has_company_permission('view', \"companyId\")",
      "CREATE FUNCTION has_company_permission(claim text, company text) RETURNS bool LANGUAGE sql AS $$ SELECT true $$;"
    ].join("\n");
    expect(noLegacyRls.scan("p.sql", sql)).toHaveLength(0);
  });

  it("flags a call inside a function body", () => {
    const sql = [
      "CREATE FUNCTION f() RETURNS bool LANGUAGE plpgsql AS $$",
      "BEGIN",
      "  RETURN has_company_permission('view', 'c');",
      "END $$;"
    ].join("\n");
    expect(noLegacyRls.scan("p.sql", sql).map((v) => v.line)).toEqual([3]);
  });
  it("leaves a generated authz migration alone: it holds the helper's own policies", () => {
    const sql = `${GENERATED_AUTHZ_MIGRATION}\nCREATE POLICY "p" ON "t" USING (has_company_permission('view', "companyId"));`;
    expect(noLegacyRls.scan("p.sql", sql)).toHaveLength(0);
  });
});
