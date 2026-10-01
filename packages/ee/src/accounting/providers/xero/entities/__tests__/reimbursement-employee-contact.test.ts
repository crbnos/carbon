// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Copyright (C) Carbon Manufacturing Systems Corporation.
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReimbursementSource } from "../../../../core/reimbursement-source";
import { XeroReimbursementSyncer } from "../reimbursement";

// The JIT employee Contact is created in one call and mapped in a SEPARATE
// transaction. A crash (or a failed link) between the two leaves a Contact in
// Xero that Carbon has no mapping row for — and Xero enforces unique contact
// names, so the retry's POST fails with a duplicate-name validation error.
// Without a lookup-before-create that reimbursement can never sync again.

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

/** The Name `employeeVendorName` derives for the fixture. */
const CONTACT_NAME = "Dana Okafor (dana@example.com)";

function syncer(request: ReturnType<typeof vi.fn>) {
  const instance = new XeroReimbursementSyncer({
    database: {} as never,
    companyId: "company-1",
    entityType: "reimbursement",
    config: { enabled: true, direction: "push-to-accounting", owner: "carbon" },
    provider: { id: "xero", request } as never
  });
  return instance as unknown as {
    resolveEmployeeContact(local: ReimbursementSource): Promise<string>;
  };
}

beforeEach(() => mappings.clear());

describe("Xero employee-contact JIT create", () => {
  it("adopts the existing Contact found by exact name instead of POSTing a duplicate", async () => {
    const request = vi.fn(async (method: string, _url: string) => {
      if (method === "GET") {
        return {
          data: {
            Contacts: [
              { ContactID: "contact-orphan", Name: CONTACT_NAME },
              // A different person — must not be adopted.
              { ContactID: "contact-other", Name: "Someone Else" }
            ]
          }
        };
      }
      throw new Error(`unexpected ${method}`);
    });

    const contactId =
      await syncer(request).resolveEmployeeContact(reimbursement);

    expect(contactId).toBe("contact-orphan");
    // Exactly one round trip: the lookup. Nothing was created.
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toBe("GET");
    expect(request.mock.calls[0]?.[1]).toContain(
      encodeURIComponent(`Name==${JSON.stringify(CONTACT_NAME)}`)
    );
    // The adoption is what makes the retry recoverable: the mapping the first
    // attempt failed to write is written now.
    expect(mappings.get("emp_1")).toBe("contact-orphan");
  });

  it("creates the Contact with a deterministic Idempotency-Key when Xero has none", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "GET") return { data: { Contacts: [] } };
      return { data: { Contacts: [{ ContactID: "contact-new" }] } };
    });

    const contactId =
      await syncer(request).resolveEmployeeContact(reimbursement);

    expect(contactId).toBe("contact-new");
    expect(request).toHaveBeenNthCalledWith(
      2,
      "POST",
      "/Contacts",
      expect.objectContaining({
        headers: {
          "Idempotency-Key": createHash("sha256")
            .update("company-1:employee-vendor:emp_1")
            .digest("hex")
        }
      })
    );
    expect(mappings.get("emp_1")).toBe("contact-new");
  });

  it("refuses to guess when two Contacts share the employee's name", async () => {
    const request = vi.fn(async () => ({
      data: {
        Contacts: [
          { ContactID: "contact-a", Name: CONTACT_NAME },
          { ContactID: "contact-b", Name: CONTACT_NAME }
        ]
      }
    }));

    await expect(
      syncer(request).resolveEmployeeContact(reimbursement)
    ).rejects.toThrow(/Multiple Xero contacts are named/);
    expect(mappings.size).toBe(0);
  });
});
