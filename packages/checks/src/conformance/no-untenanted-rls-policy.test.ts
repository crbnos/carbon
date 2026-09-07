import { describe, expect, it } from "vitest";
import { noUntenantedRlsPolicy } from "./no-untenanted-rls-policy";

describe("no-untenanted-rls-policy", () => {
  it("flags the eventSystemSubscription policy this check exists for", () => {
    const sql = `CREATE POLICY "manage_subscriptions" ON "public"."eventSystemSubscription"
FOR ALL USING ((SELECT auth.role()) = 'authenticated');`;
    const violations = noUntenantedRlsPolicy.scan("a.sql", sql);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(1);
    expect(violations[0]?.message).toContain("eventSystemSubscription");
  });

  it("flags the bare auth.role() spelling too", () => {
    const sql = `CREATE POLICY "p" ON "t" FOR SELECT USING (auth.role() = 'authenticated');`;
    expect(noUntenantedRlsPolicy.scan("a.sql", sql)).toHaveLength(1);
  });

  it("allows a policy that also scopes by companyId", () => {
    const sql = `CREATE POLICY "SELECT" ON "public"."t"
FOR SELECT USING (
  auth.role() = 'authenticated' AND "companyId" = ANY (
    (SELECT get_companies_with_employee_role())::text[]
  )
);`;
    expect(noUntenantedRlsPolicy.scan("a.sql", sql)).toHaveLength(0);
  });

  it("allows the standard permission-helper policy", () => {
    const sql = `CREATE POLICY "INSERT" ON "public"."t"
FOR INSERT WITH CHECK (
  "companyId" = ANY (
    (SELECT get_companies_with_employee_permission('settings_create'))::text[]
  )
);`;
    expect(noUntenantedRlsPolicy.scan("a.sql", sql)).toHaveLength(0);
  });

  it("allows a per-user ownership policy", () => {
    const sql = `CREATE POLICY "SELECT" ON "t" FOR SELECT USING ("userId" = auth.uid()::text);`;
    expect(noUntenantedRlsPolicy.scan("a.sql", sql)).toHaveLength(0);
  });

  it("flags a policy whose WITH CHECK is bare even when USING is scoped", () => {
    // The write side is the one that plants rows in someone else's company.
    const sql = `CREATE POLICY "p" ON "t"
FOR UPDATE USING ("companyId" = ANY ((SELECT get_companies_with_employee_role())::text[]))
WITH CHECK (auth.role() = 'authenticated');`;
    expect(noUntenantedRlsPolicy.scan("a.sql", sql)).toHaveLength(1);
  });

  it("ignores a policy with no USING or WITH CHECK clause", () => {
    const sql = `CREATE POLICY "p" ON "t" FOR SELECT TO authenticated;`;
    expect(noUntenantedRlsPolicy.scan("a.sql", sql)).toHaveLength(0);
  });

  it("does not run past the statement terminator into the next policy", () => {
    const sql = [
      `CREATE POLICY "a" ON "t" FOR SELECT USING (auth.role() = 'authenticated');`,
      `CREATE POLICY "b" ON "t" FOR INSERT WITH CHECK ("companyId" = ANY ((SELECT get_companies_with_employee_role())::text[]));`
    ].join("\n");
    const violations = noUntenantedRlsPolicy.scan("a.sql", sql);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(1);
  });
});
