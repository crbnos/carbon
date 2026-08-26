import { describe, expect, it } from "vitest";
import { getVisibleReportCatalog, reportCatalog } from "./reportCatalog";

describe("reportCatalog", () => {
  it("defines stable metadata and CSV support for every current report", () => {
    expect(reportCatalog).toHaveLength(13);
    expect(new Set(reportCatalog.map((report) => report.key)).size).toBe(
      reportCatalog.length
    );

    for (const report of reportCatalog) {
      expect(report.label).toBeTruthy();
      expect(report.description).toBeTruthy();
      expect(report.category).toBeTruthy();
      expect(report.route).toMatch(/^\/x\//);
      expect(report.defaultPinned).toEqual(expect.any(Boolean));
      expect(report.allowedRole).toBe("employee");
      expect(report.requiredViewPermission).toBe("accounting");
      expect(report.supportedExportFormats).toEqual(["csv"]);
    }
  });

  it("shows accounting reports only to employees with accounting view access", () => {
    expect(
      getVisibleReportCatalog({
        role: "employee",
        viewPermissions: ["accounting"]
      })
    ).toEqual(reportCatalog);

    expect(
      getVisibleReportCatalog({ role: "employee", viewPermissions: [] })
    ).toEqual([]);
  });

  it("does not expose the employee catalog to customer or supplier roles", () => {
    expect(
      getVisibleReportCatalog({
        role: "customer",
        viewPermissions: ["accounting"]
      })
    ).toEqual([]);
    expect(
      getVisibleReportCatalog({
        role: "supplier",
        viewPermissions: ["accounting"]
      })
    ).toEqual([]);
  });
});
