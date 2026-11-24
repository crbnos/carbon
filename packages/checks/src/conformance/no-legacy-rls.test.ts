// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { noLegacyRls } from "./no-legacy-rls";

describe("noLegacyRls", () => {
  it("flags has_company_permission(...)", () => {
    const sql = "USING (has_company_permission('view', \"companyId\"))";
    const v = noLegacyRls.scan("p.sql", sql);
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(1);
  });

  it("flags the purchasingRfq policies that f25eba584c converted", () => {
    // 20260115143000_purchasing-rfq.sql before f25eba584c: the per-row helper
    // ran for every row and could not use an index.
    const sql = `CREATE POLICY "Employees with purchasing_view can view purchasingRfq"
  ON "purchasingRfq" FOR SELECT USING (
    has_company_permission('purchasing_view', "companyId") AND
    has_role('employee', "companyId")
  );

CREATE POLICY "Employees with purchasing_create can insert purchasingRfq"
  ON "purchasingRfq" FOR INSERT WITH CHECK (
    has_company_permission('purchasing_create', "companyId") AND
    has_role('employee', "companyId")
  );`;
    expect(
      noLegacyRls
        .scan("20260115143000_purchasing-rfq.sql", sql)
        .map((v) => v.line)
    ).toEqual([3, 9]);
  });

  it("allows the current get_companies_with_employee_permission helper", () => {
    const sql =
      "USING (\"companyId\" = ANY ((SELECT get_companies_with_employee_permission('view'))::text[]))";
    const v = noLegacyRls.scan("p.sql", sql);
    expect(v).toHaveLength(0);
  });
});
