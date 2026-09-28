import { describe, expect, it } from "vitest";
import { noRawOrFilter } from "./no-raw-or-filter";

const SERVICE = "apps/erp/app/modules/sales/sales.service.ts";
const scan = (ts: string, file = SERVICE) => noRawOrFilter.scan(file, ts);

describe("noRawOrFilter", () => {
  it("flags a search value interpolated into .or()", () => {
    const ts = [
      "export async function getWidgets(client, args) {",
      "  if (args.search) {",
      "    query = query.or(",
      "      `name.ilike.%${args.search}%,code.ilike.%${args.search}%`",
      "    );",
      "  }",
      "}"
    ].join("\n");
    const v = scan(ts);
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(3);
    expect(v[0]?.snippet).toContain("getWidgets: .or(`name.ilike");
  });

  it("flags any caller value, whatever the variable is called", () => {
    for (const expr of ["term", "args.query", "searchTerm", "date"]) {
      const ts = `query = query.or(\`name.ilike.%\${${expr}}%\`);`;
      expect(scan(ts), expr).toHaveLength(1);
    }
  });

  it("flags a value sanitised by hand: setSearchFilter is the one path", () => {
    const ts = [
      'const search = args.search.replace(/[,()\\\\]/g, " ");',
      "query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%`);"
    ].join("\n");
    expect(scan(ts)).toHaveLength(1);
  });

  it("allows id lists inside in.(…) and id-named values", () => {
    const ts = [
      "query = query.or(`customerId.in.(${csv}),supplierId.in.(${csv})`);",
      "query = query.or(`jobOperationId.in.(${quoted(ids)})`);",
      "query = query.or(`companyId.eq.${companyId},companyId.is.null`);",
      'query = query.or(`shipmentId.eq.${shipmentId},opportunityId.eq.${order.data?.opportunityId ?? ""}`);',
      'query = query.or("isCustomerTypeGroup.eq.true,isCustomerOrgGroup.eq.true");'
    ].join("\n");
    expect(scan(ts)).toHaveLength(0);
  });

  it("flags a dotted embedded column in a top-level .or()", () => {
    const ts = 'query = query.or("jobOperation.description.ilike.%x%");';
    const v = scan(ts);
    expect(v).toHaveLength(1);
    expect(v[0]?.message).toContain("embedded column");
  });

  it("flags a dotted embedded column mixed with a native one", () => {
    const ts = 'query = query.or("notes.ilike.%x%,item.name.ilike.%x%");';
    expect(scan(ts)).toHaveLength(1);
  });

  it("allows dotted operators, nested logic and an .or() scoped to an embed", () => {
    const ts = [
      'query = query.or("name.not.ilike.%x%,and(a.is.null,b.eq.1)");',
      'query = query.or("description.ilike.%x%", { referencedTable: "jobOperation" });'
    ].join("\n");
    expect(scan(ts)).toHaveLength(0);
  });

  it("does not inspect a non-literal argument", () => {
    const ts = [
      "query = query.or(buildFilter(args.search));",
      'query = query.or(conditions.join(","));'
    ].join("\n");
    expect(scan(ts)).toHaveLength(0);
  });

  it("ignores Kysely eb.or([…]) and comments", () => {
    const ts = [
      'eb.or([eb("a", "=", 1), eb("b", "=", 2)]);',
      "// query.or(`name.ilike.%${args.search}%`)"
    ].join("\n");
    expect(scan(ts)).toHaveLength(0);
  });

  it("only scans ERP service files", () => {
    const ts = "query = query.or(`name.ilike.%${search}%`);";
    expect(scan(ts, "apps/erp/app/utils/query.ts")).toHaveLength(0);
  });
});
