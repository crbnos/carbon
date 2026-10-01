// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReimbursementSource } from "../../../../core/reimbursement-source";
import { AccountingApiError } from "../../../../core/utils";
import type { Qbo } from "../../models";
import { buildQboRequestId } from "../../provider";
import { QboReimbursementSyncer } from "../reimbursement";

// The JIT employee Vendor is created in one call and mapped in a SEPARATE
// transaction. A crash (or a failed link) between the two leaves a Vendor in
// QuickBooks that Carbon has no mapping row for — and QBO's name namespace is
// unique, so the retry's create fails with fault 6240. Without adoption that
// reimbursement can never sync again.

const { mappings } = vi.hoisted(() => ({
  mappings: new Map<string, string>()
}));

vi.mock("../../../../core/external-mapping", () => ({
  createMappingService: () => ({
    getByEntity: async () => null,
    getExternalId: async (_type: string, id: string) =>
      mappings.get(id) ?? null,
    link: async (
      _type: string,
      id: string,
      _provider: string,
      externalId: string
    ) => {
      mappings.set(id, externalId);
    }
  })
}));

vi.mock("../../../../core/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../core/utils")>()),
  withTriggersDisabled: async (
    _db: unknown,
    operation: (tx: unknown) => Promise<unknown>
  ) => operation({})
}));

const reimbursement: ReimbursementSource = {
  id: "reimb_1",
  companyId: "company-1",
  reimbursementId: "REIMB-2026-09-000001",
  employeeId: "emp_1",
  status: "Posted",
  integration: "ramp",
  reimbursementDate: "2026-09-18",
  postingDate: "2026-09-20",
  currencyCode: "USD",
  exchangeRate: 1,
  amount: 620,
  payableAccountId: "acct_employee_payable",
  reference: "Trip to Austin",
  notes: null,
  updatedAt: "2026-09-20T10:00:00.000Z",
  employee: {
    id: "emp_1",
    firstName: "Dana",
    lastName: "Okafor",
    email: "dana@example.com"
  },
  // No mapping row yet — this is the JIT path under test.
  employeeVendorExternalId: null,
  baseCurrencyCode: "USD",
  decimalPlaces: 2,
  lines: [
    {
      id: "reimbl_1",
      accountId: "acct_travel",
      description: "Flights",
      amount: 620,
      sequence: 0,
      dimensions: []
    }
  ]
};

/** The DisplayName `employeeVendorName` derives for the fixture. */
const DISPLAY_NAME = "Dana Okafor (dana@example.com)";

function duplicateNameFault(): AccountingApiError {
  return new AccountingApiError("quickbooks", "create vendor", {
    statusCode: 400,
    statusText: "Bad Request",
    providerErrorCode: "6240",
    providerMessage: "Duplicate Name Exists Error"
  });
}

function syncer(provider: object) {
  const instance = new QboReimbursementSyncer({
    database: {} as never,
    companyId: "company-1",
    entityType: "reimbursement",
    config: { enabled: true, direction: "push-to-accounting", owner: "carbon" },
    provider: { id: "quickbooks", ...provider } as never
  });
  return instance as unknown as {
    resolveEmployeeVendor(local: ReimbursementSource): Promise<string>;
  };
}

beforeEach(() => mappings.clear());

describe("QBO employee-vendor JIT create", () => {
  it("keys the create on a deterministic requestid so Intuit replays a lost response", async () => {
    const createVendor = vi.fn(async () => ({ Id: "vend_9" }) as Qbo.Vendor);
    const vendorId = await syncer({ createVendor }).resolveEmployeeVendor(
      reimbursement
    );

    expect(vendorId).toBe("vend_9");
    expect(createVendor).toHaveBeenCalledWith(
      expect.objectContaining({ DisplayName: DISPLAY_NAME }),
      buildQboRequestId("company-1", "employee-vendor", "emp_1")
    );
    // The mapping the next attempt reads instead of creating again.
    expect(mappings.get("emp_1")).toBe("vend_9");
  });

  it("adopts the existing Vendor on fault 6240 instead of failing forever", async () => {
    const createVendor = vi.fn(async () => {
      throw duplicateNameFault();
    });
    const query = vi.fn(async () => [
      { Id: "vend_orphan", DisplayName: DISPLAY_NAME } as Qbo.Vendor
    ]);

    const vendorId = await syncer({
      createVendor,
      query
    }).resolveEmployeeVendor(reimbursement);

    expect(vendorId).toBe("vend_orphan");
    expect(query).toHaveBeenCalledWith(
      "Vendor",
      `DisplayName = '${DISPLAY_NAME}'`
    );
    // The adoption is what makes the retry recoverable: the mapping the first
    // attempt failed to write is written now.
    expect(mappings.get("emp_1")).toBe("vend_orphan");
  });

  it("rethrows fault 6240 when the colliding name belongs to no Vendor", async () => {
    // A Customer or Employee holds the name — a real collision a human must
    // resolve in QuickBooks, never guessed at.
    const createVendor = vi.fn(async () => {
      throw duplicateNameFault();
    });
    const query = vi.fn(async () => []);

    await expect(
      syncer({ createVendor, query }).resolveEmployeeVendor(reimbursement)
    ).rejects.toThrow(/Duplicate Name Exists/);
    expect(mappings.size).toBe(0);
  });

  it("does not swallow a non-duplicate fault", async () => {
    const createVendor = vi.fn(async () => {
      throw new AccountingApiError("quickbooks", "create vendor", {
        statusCode: 500,
        statusText: "Internal Server Error"
      });
    });
    const query = vi.fn(async () => []);

    await expect(
      syncer({ createVendor, query }).resolveEmployeeVendor(reimbursement)
    ).rejects.toThrow(/Internal Server Error/);
    expect(query).not.toHaveBeenCalled();
  });
});
