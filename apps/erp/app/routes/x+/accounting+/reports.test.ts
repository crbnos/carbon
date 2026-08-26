import { describe, expect, it, vi } from "vitest";

vi.mock("@lingui/core/macro", () => ({
  msg: (parts: TemplateStringsArray) => ({
    id: parts[0],
    message: parts[0]
  })
}));

import { getSerializedReportsHubData } from "./reports.loader";

describe("reports hub loader data", () => {
  it("does not serialize hidden report pins or saved-view metadata", () => {
    const result = getSerializedReportsHubData({
      currentUserId: "user-1",
      pinOverrides: [
        { reportKey: "income-statement", pinned: true },
        { reportKey: "executive-pnl", pinned: true },
        { reportKey: "view:visible-view", pinned: true },
        { reportKey: "view:hidden-view", pinned: true }
      ],
      savedViews: [
        {
          id: "visible-view",
          name: "Visible View",
          reportKey: "income-statement",
          visibility: "Private",
          createdBy: "user-1"
        },
        {
          id: "hidden-view",
          name: "Hidden View",
          reportKey: "executive-pnl",
          visibility: "Company",
          createdBy: "user-2"
        }
      ],
      visibleReports: [
        {
          key: "income-statement"
        }
      ]
    });

    expect(result).toEqual({
      currentUserId: "user-1",
      pinOverrides: [
        { reportKey: "income-statement", pinned: true },
        { reportKey: "view:visible-view", pinned: true }
      ],
      savedViews: [
        {
          id: "visible-view",
          name: "Visible View",
          reportKey: "income-statement",
          visibility: "Private",
          createdBy: "user-1"
        }
      ]
    });
  });
});
