import { describe, expect, it } from "vitest";
import { noLegacyRls } from "./no-legacy-rls";

describe("noLegacyRls", () => {
  it("flags has_company_permission(...)", () => {
    const sql = "USING (has_company_permission('view', \"companyId\"))";
    const v = noLegacyRls.scan("p.sql", sql);
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(1);
  });

  it("allows the current get_companies_with_employee_permission helper", () => {
    const sql =
      "USING (\"companyId\" = ANY ((SELECT get_companies_with_employee_permission('view'))::text[]))";
    const v = noLegacyRls.scan("p.sql", sql);
    expect(v).toHaveLength(0);
  });

  it("records provenance pointing at the RLS refactor migration", () => {
    expect(noLegacyRls.provenance.since).toBe(
      "20250201181148_rls-refactor.sql"
    );
  });
});
