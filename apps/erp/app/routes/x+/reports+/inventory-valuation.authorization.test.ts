import { requirePermissions } from "@carbon/auth/auth.server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loader } from "./inventory-valuation";
import { action } from "./inventory-valuation.reconcile";

vi.mock("@carbon/auth/auth.server", () => ({
  requirePermissions: vi.fn()
}));

vi.mock("@carbon/auth", () => ({
  assertIsPost: vi.fn(),
  error: vi.fn(),
  success: vi.fn()
}));

vi.mock("@carbon/auth/session.server", () => ({
  flash: vi.fn()
}));

vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => strings[0]
}));

vi.mock("@carbon/glossary", () => ({
  terms: {},
  getEntry: vi.fn(),
  lookupEntry: vi.fn(),
  hasEntry: vi.fn(),
  termSlug: vi.fn(),
  glossaryEntries: () => []
}));

vi.mock("~/modules/inventory", () => ({
  createInventoryReconciliationJournal: vi.fn(),
  getInventoryValuation: vi.fn(),
  getInventoryValuationTieOut: vi.fn(),
  InventoryValuationWorkbench: vi.fn()
}));

vi.mock("~/modules/settings", () => ({
  getCompanySettings: vi.fn()
}));

vi.mock("~/modules/shared/timezone.server", () => ({
  getCompanyTimeZone: vi.fn()
}));

vi.mock("~/services/database.server", () => ({
  getDatabaseClient: vi.fn()
}));

vi.mock("~/utils/path", () => ({
  path: {
    to: {
      accountingJournals: "/x/accounting/journals",
      inventoryValuation: "/x/reports/inventory-valuation"
    }
  }
}));

const stopAfterAuthorization = new Error("stop after authorization");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePermissions).mockRejectedValue(stopAfterAuthorization);
});

describe("inventory valuation authorization", () => {
  it("requires an employee with accounting view permission", async () => {
    const request = new Request(
      "http://localhost/x/reports/inventory-valuation"
    );

    await expect(loader({ request } as any)).rejects.toBe(
      stopAfterAuthorization
    );

    expect(requirePermissions).toHaveBeenCalledWith(request, {
      view: "accounting",
      role: "employee"
    });
  });

  it("requires an employee with accounting create permission to reconcile", async () => {
    const request = new Request(
      "http://localhost/x/reports/inventory-valuation/reconcile",
      { method: "POST" }
    );

    await expect(action({ request } as any)).rejects.toBe(
      stopAfterAuthorization
    );

    expect(requirePermissions).toHaveBeenCalledWith(request, {
      create: "accounting",
      role: "employee"
    });
  });
});
