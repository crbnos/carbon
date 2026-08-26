import { describe, expect, it, vi } from "vitest";

vi.mock("@lingui/core/macro", () => ({
  msg: (parts: TemplateStringsArray) => ({
    id: parts[0],
    message: parts[0]
  })
}));

import {
  filterSavedViewsByVisibleReportKeys,
  getVisibleReportCatalog,
  reportCatalog
} from "./reportCatalog";

describe("reportCatalog", () => {
  it("defines stable metadata and CSV support for every current report", () => {
    expect(reportCatalog).toHaveLength(13);
    expect(new Set(reportCatalog.map((report) => report.key)).size).toBe(
      reportCatalog.length
    );

    for (const report of reportCatalog) {
      expect(report.label).toMatchObject({
        id: expect.any(String),
        message: expect.any(String)
      });
      expect(report.description).toMatchObject({
        id: expect.any(String),
        message: expect.any(String)
      });
      expect(report.category).toMatchObject({
        id: expect.any(String),
        message: expect.any(String)
      });
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

  it("filters saved views to reports that remain visible", () => {
    const visibleReports = reportCatalog.filter(
      (report) => report.key !== "executive-pnl"
    );
    const savedViews = [
      { id: "view-income", name: "Income View", reportKey: "income-statement" },
      { id: "view-pnl", name: "Executive View", reportKey: "executive-pnl" }
    ];

    expect(
      filterSavedViewsByVisibleReportKeys({
        savedViews,
        visibleReports
      })
    ).toEqual([savedViews[0]]);
  });

  it("does not let a pinned saved view reappear when its parent report is hidden", () => {
    const visibleReports = reportCatalog.filter(
      (report) => report.key === "income-statement"
    );
    const savedViews = [
      {
        id: "visible-view",
        name: "Visible View",
        reportKey: "income-statement",
        pinned: false
      },
      {
        id: "hidden-view",
        name: "Hidden View",
        reportKey: "executive-pnl",
        pinned: true
      }
    ];

    expect(
      filterSavedViewsByVisibleReportKeys({
        savedViews,
        visibleReports
      })
    ).toEqual([savedViews[0]]);
  });
});
