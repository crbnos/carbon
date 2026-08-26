import { requirePermissions } from "@carbon/auth/auth.server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getInventoryValuation,
  getInventoryValuationTieOut
} from "~/modules/inventory";
import { getCompanySettings } from "~/modules/settings";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { isReportSourceComplete } from "~/utils/reportExport";
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

vi.mock("~/utils/reportExport", () => ({
  isReportSourceComplete: vi.fn()
}));

const stopAfterAuthorization = new Error("stop after authorization");

function queryResult(data: unknown, error: unknown = null) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order"]) {
    builder[method] = () => builder;
  }
  builder.then = (resolve: (value: unknown) => unknown) =>
    resolve({ data, error });
  return builder;
}

function makeLoaderClient(locationResult: unknown) {
  return {
    from(table: string) {
      if (table === "location") return locationResult;
      throw new Error(`Unexpected table: ${table}`);
    }
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePermissions).mockRejectedValue(stopAfterAuthorization);
  vi.mocked(getCompanyTimeZone).mockResolvedValue("UTC" as never);
  vi.mocked(getCompanySettings).mockResolvedValue({
    data: { accountingEnabled: false },
    error: null
  } as never);
  vi.mocked(getInventoryValuation).mockResolvedValue({
    data: [],
    error: null
  } as never);
  vi.mocked(getInventoryValuationTieOut).mockResolvedValue({
    data: [],
    error: null
  } as never);
  vi.mocked(isReportSourceComplete).mockImplementation((...sources) =>
    sources.every((source) => source != null && source.length < 1000)
  );
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

  it.each([
    {
      name: "location metadata query error",
      result: queryResult(null, { message: "location lookup failed" })
    },
    {
      name: "location metadata is null",
      result: queryResult(null)
    },
    {
      name: "location metadata reaches the row cap",
      result: queryResult(
        new Array(1000).fill({ id: "location", name: "Location" })
      )
    }
  ])("blocks the loader for incomplete $name", async ({ result }) => {
    vi.mocked(requirePermissions).mockResolvedValue({
      client: makeLoaderClient(result),
      companyId: "company-1"
    } as never);

    await expect(
      loader({
        request: new Request("http://localhost/x/reports/inventory-valuation")
      } as never)
    ).rejects.toThrow();
  });

  it("blocks a selected location that is absent from complete metadata", async () => {
    vi.mocked(requirePermissions).mockResolvedValue({
      client: makeLoaderClient(
        queryResult([{ id: "location-1", name: "Main" }])
      ),
      companyId: "company-1"
    } as never);

    await expect(
      loader({
        request: new Request(
          "http://localhost/x/reports/inventory-valuation?locationId=missing"
        )
      } as never)
    ).rejects.toThrow();
  });
});
