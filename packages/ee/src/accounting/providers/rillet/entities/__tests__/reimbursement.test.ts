import { beforeEach, describe, expect, it, vi } from "vitest";
import { JournalEntrySyncError } from "../../../../core/posting";
import type { ReimbursementSource } from "../../../../core/reimbursement-source";
import type {
  RilletReimbursementCreate,
  RilletVendorWrite
} from "../../models";
import {
  mapReimbursementToRilletReimbursement,
  RilletReimbursementSyncer
} from "../reimbursement";

// Only the DB loaders in ./shared are stubbed; the base syncer's push
// workflow under test stays the production one.
vi.mock("../shared", async (importOriginal) => {
  const original = await importOriginal<typeof import("../shared")>();
  return {
    ...original,
    loadRilletAccountCodesById: vi.fn(
      async () =>
        new Map([
          ["acct_travel", "6100"],
          ["acct_meals", "6200"],
          ["acct_employee_payable", "2180"]
        ])
    )
  };
});

const { linked } = vi.hoisted(() => ({ linked: [] as unknown[] }));
vi.mock("../../../../core/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../core/utils")>()),
  withTriggersDisabled: async (
    _db: unknown,
    cb: (tx: unknown) => Promise<unknown>
  ) => {
    const b = {
      values: (row: unknown) => {
        linked.push(row);
        return b;
      },
      onConflict: () => b,
      execute: async () => []
    };
    return cb({ insertInto: () => b });
  }
}));

const reimbursement = (
  overrides: Partial<ReimbursementSource> = {}
): ReimbursementSource => ({
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
  employeeVendorExternalId: "rillet-employee-vendor-uuid",
  baseCurrencyCode: "USD",
  decimalPlaces: 2,
  lines: [
    {
      id: "reimbl_1",
      accountId: "acct_travel",
      description: "Flights",
      amount: 500,
      sequence: 0,
      dimensions: [{ dimensionId: "dim_cc", valueId: "cc_eng" }]
    },
    {
      id: "reimbl_2",
      accountId: "acct_meals",
      description: "Meals",
      amount: 120,
      sequence: 1,
      dimensions: []
    }
  ],
  ...overrides
});

describe("mapReimbursementToRilletReimbursement", () => {
  it("builds one item per coded line, with the stored payable control account", () => {
    const payload = mapReimbursementToRilletReimbursement({
      reimbursement: reimbursement(),
      vendorRemoteId: "rillet-employee-vendor-uuid",
      accountCodesById: new Map([
        ["acct_travel", "6100"],
        ["acct_meals", "6200"],
        ["acct_employee_payable", "2180"]
      ]),
      subsidiaryId: "rillet-subsidiary-uuid",
      companyId: "company-1",
      dimensions: {
        fieldIdByDimensionId: new Map([["dim_cc", "rillet-field-uuid"]]),
        fieldValueIdsByValue: new Map([
          ["dim_cc:cc_eng", "rillet-field-value-uuid"]
        ])
      }
    });

    // Field names VERIFIED against Rillet's published OpenAPI
    // (docs.api.rillet.com/reference/create-a-reimbursement, 2026-09-23):
    // vendor_id, items[], reimbursement_date and payable_account_code are
    // REQUIRED; impact_date, subsidiary_id, external_references and
    // exchange_rate are optional. There is no `date`/`gl_impact_date` pair
    // here — that is the vendor-credit shape.
    expect(payload).toMatchObject({
      vendor_id: "rillet-employee-vendor-uuid",
      reimbursement_date: "2026-09-18",
      impact_date: "2026-09-20",
      payable_account_code: "2180",
      subsidiary_id: "rillet-subsidiary-uuid",
      items: [
        {
          account_code: "6100",
          amount: { amount: "500.00", currency: "USD" },
          description: "Flights",
          fields: [
            {
              field_id: "rillet-field-uuid",
              field_value_id: "rillet-field-value-uuid"
            }
          ]
        },
        {
          account_code: "6200",
          amount: { amount: "120.00", currency: "USD" },
          description: "Meals"
        }
      ]
    });
    expect(payload.external_references).toEqual([
      { type: "carbon", id: "reimb_1" },
      { type: "carbon-company", id: "company-1" }
    ]);
    // A line with no resolvable dimension ref sends no `fields` key at all.
    expect(payload.items[1]).not.toHaveProperty("fields");
    expect(payload).not.toHaveProperty("date");
    expect(payload).not.toHaveProperty("gl_impact_date");
  });

  it("warns UNMAPPED_ACCOUNTS when the payable control account has no Rillet code", () => {
    expect(() =>
      mapReimbursementToRilletReimbursement({
        reimbursement: reimbursement(),
        vendorRemoteId: "rillet-employee-vendor-uuid",
        // Lines map; the payable does not.
        accountCodesById: new Map([
          ["acct_travel", "6100"],
          ["acct_meals", "6200"]
        ]),
        subsidiaryId: null,
        companyId: "company-1"
      })
    ).toThrow(JournalEntrySyncError);

    try {
      mapReimbursementToRilletReimbursement({
        reimbursement: reimbursement(),
        vendorRemoteId: "rillet-employee-vendor-uuid",
        accountCodesById: new Map([
          ["acct_travel", "6100"],
          ["acct_meals", "6200"]
        ]),
        subsidiaryId: null,
        companyId: "company-1"
      });
      throw new Error("expected a JournalEntrySyncError");
    } catch (err) {
      const failure = (err as JournalEntrySyncError).failure;
      expect(failure.errorCode).toBe("UNMAPPED_ACCOUNTS");
      expect(failure.warning).toBe(true);
      expect(failure.metadata?.unmappedAccountIds).toEqual([
        "acct_employee_payable"
      ]);
    }
  });

  it("warns when the reimbursement carries no payable control account at all", () => {
    expect(() =>
      mapReimbursementToRilletReimbursement({
        reimbursement: reimbursement({ payableAccountId: null }),
        vendorRemoteId: "rillet-employee-vendor-uuid",
        accountCodesById: new Map([
          ["acct_travel", "6100"],
          ["acct_meals", "6200"]
        ]),
        subsidiaryId: null,
        companyId: "company-1"
      })
    ).toThrow(/employee-payable control account/);
  });
});

/** In-memory ExternalIntegrationMappingService stand-in. */
function fakeMappingService(mapping: unknown = null) {
  return {
    getByEntity: vi.fn(async () => mapping),
    getExternalId: vi.fn(async () => null),
    link: vi.fn(async () => undefined)
  };
}

function setupSyncer(args: { local: ReimbursementSource; mapping?: unknown }) {
  linked.length = 0;
  const createReimbursement = vi.fn(
    async (_payload: RilletReimbursementCreate) => ({
      id: "rillet-reimbursement-1"
    })
  );
  const deleteReimbursement = vi.fn(async (_id: string) => undefined);
  const createVendor = vi.fn(
    async (_payload: RilletVendorWrite, _key?: string) => ({
      id: "rillet-new-vendor-1"
    })
  );

  const syncer = new RilletReimbursementSyncer({
    database: {} as never,
    companyId: "company-1",
    entityType: "reimbursement",
    config: { enabled: true, direction: "push-to-accounting", owner: "carbon" },
    provider: {
      id: "rillet",
      subsidiaryId: null,
      createReimbursement,
      deleteReimbursement,
      createVendor
    } as never
  });

  vi.spyOn(syncer, "fetchLocal").mockResolvedValue(args.local);
  (syncer as any).mappingService = fakeMappingService(args.mapping ?? null);
  (syncer as any).resolveLineDimensions = vi.fn(async () => ({
    fieldIdByDimensionId: new Map(),
    fieldValueIdsByValue: new Map()
  }));

  return { syncer, createReimbursement, deleteReimbursement, createVendor };
}

describe("RilletReimbursementSyncer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POSTs /reimbursements for a Posted row", async () => {
    const { syncer, createReimbursement } = setupSyncer({
      local: reimbursement()
    });

    const result = await syncer.pushToAccounting("reimb_1");

    expect(result.status).toBe("success");
    expect(result.remoteId).toBe("rillet-reimbursement-1");
    expect(createReimbursement).toHaveBeenCalledTimes(1);
    expect(createReimbursement.mock.calls[0]?.[0]).toMatchObject({
      payable_account_code: "2180",
      items: [{ account_code: "6100" }, { account_code: "6200" }]
    });
  });

  it("creates the provider-side employee vendor when the employee is not linked yet", async () => {
    const { syncer, createVendor, createReimbursement } = setupSyncer({
      local: reimbursement({ employeeVendorExternalId: null })
    });

    await syncer.pushToAccounting("reimb_1");

    // The employee-as-vendor representation lives provider-side ONLY — no
    // Carbon supplier row is created, which is the point of the document.
    expect(createVendor).toHaveBeenCalledTimes(1);
    expect(createVendor.mock.calls[0]?.[0]).toMatchObject({
      name: "Dana Okafor (dana@example.com)",
      email: "dana@example.com"
    });
    expect(createReimbursement.mock.calls[0]?.[0]?.vendor_id).toBe(
      "rillet-new-vendor-1"
    );
    // Linked under employeeVendor, NOT vendor: that id space holds Carbon
    // supplier ids.
    expect(linked).toContainEqual(
      expect.objectContaining({
        entityType: "employeeVendor",
        entityId: "emp_1",
        externalId: "rillet-new-vendor-1"
      })
    );
    expect(linked).not.toContainEqual(
      expect.objectContaining({ entityType: "vendor" })
    );
  });

  it("skips a Draft reimbursement with a reason, so its journal keeps pushing", async () => {
    const { syncer, createReimbursement } = setupSyncer({
      local: reimbursement({ status: "Draft" })
    });

    const result = await syncer.pushToAccounting("reimb_1");

    expect(result.status).toBe("skipped");
    expect(result.error).toMatch(/must be posted/i);
    expect(createReimbursement).not.toHaveBeenCalled();
  });

  it("DELETEs /reimbursements/{id} when a pushed reimbursement is voided", async () => {
    const { syncer, deleteReimbursement, createReimbursement } = setupSyncer({
      local: reimbursement({ status: "Voided" }),
      mapping: {
        externalId: "rillet-reimbursement-1",
        metadata: null,
        lastSyncedAt: "2026-09-20T10:00:00.000Z"
      }
    });

    const result = await syncer.pushToAccounting("reimb_1");

    expect(result.status).toBe("success");
    expect(result.action).toBe("deleted");
    expect(deleteReimbursement).toHaveBeenCalledWith("rillet-reimbursement-1");
    expect(createReimbursement).not.toHaveBeenCalled();
  });
});
