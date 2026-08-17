import { describe, expect, it, vi } from "vitest";
import {
  isJournalEntrySyncFailure,
  JournalEntrySyncError
} from "../../../../core/posting";
import type { Accounting, SyncContext } from "../../../../core/types";
import { AccountingApiError } from "../../../../core/utils";
import type { Qbo } from "../../models";
import { extractQboErrorDetails, QBO_FAULT_CODES } from "../../provider";
import {
  mapContactToQboContact,
  mapQboContactToLocal,
  QBO_NAME_MAX_LENGTH,
  QboEntitySyncer,
  type QboWriteOmit,
  toQboNameExistsError,
  updateWithSyncTokenRetry
} from "../shared";

const makeContact = (
  overrides?: Partial<Accounting.Contact>
): Accounting.Contact => ({
  id: "cust-1",
  name: "Acme Manufacturing",
  firstName: "Jane",
  lastName: "Doe",
  companyId: "company-1",
  email: "jane@acme.example",
  website: null,
  taxId: null,
  currencyCode: "USD",
  balance: null,
  creditLimit: null,
  paymentTerms: null,
  updatedAt: "2026-07-01T12:00:00.000Z",
  workPhone: "555-0100",
  mobilePhone: "555-0101",
  fax: null,
  homePhone: null,
  isVendor: false,
  isCustomer: true,
  addresses: [
    {
      label: "HQ",
      type: null,
      line1: "1 Factory Way",
      line2: "Suite 2",
      city: "Cleveland",
      country: "US",
      region: "OH",
      postalCode: "44101"
    }
  ],
  raw: {},
  ...overrides
});

function makeQboFaultError(code: string, message: string): AccountingApiError {
  const details = extractQboErrorDetails(400, "Bad Request", {
    Fault: {
      Error: [{ Message: message, Detail: `${message}.`, code, element: "" }],
      type: "ValidationFault"
    }
  });
  return new AccountingApiError("quickbooks", "create customer", details);
}

describe("mapContactToQboContact (to-remote fixture)", () => {
  it("maps name, email, phone and billing address onto the QBO payload", () => {
    const payload = mapContactToQboContact(makeContact(), "customer");

    expect(payload).toEqual({
      DisplayName: "Acme Manufacturing",
      PrimaryEmailAddr: { Address: "jane@acme.example" },
      PrimaryPhone: { FreeFormNumber: "555-0100" },
      BillAddr: {
        Line1: "1 Factory Way",
        Line2: "Suite 2",
        City: "Cleveland",
        CountrySubDivisionCode: "OH",
        Country: "US",
        PostalCode: "44101"
      },
      Active: true
    });
  });

  it("omits optional fields when the contact has no email/phone/address (vendor case)", () => {
    const payload = mapContactToQboContact(
      makeContact({
        email: undefined,
        workPhone: null,
        mobilePhone: null,
        homePhone: null,
        addresses: [],
        isCustomer: false,
        isVendor: true
      }),
      "vendor"
    );

    expect(payload.DisplayName).toBe("Acme Manufacturing");
    expect(payload.PrimaryEmailAddr).toBeUndefined();
    expect(payload.PrimaryPhone).toBeUndefined();
    expect(payload.BillAddr).toBeUndefined();
  });

  it("falls back through workPhone → mobilePhone → homePhone for PrimaryPhone", () => {
    const payload = mapContactToQboContact(
      makeContact({ workPhone: null }),
      "customer"
    );
    expect(payload.PrimaryPhone).toEqual({ FreeFormNumber: "555-0101" });
  });

  it("throws the structured NAME_TOO_LONG Warning past 100 characters — no silent truncation", () => {
    const longName = "x".repeat(QBO_NAME_MAX_LENGTH + 1);

    let thrown: unknown;
    try {
      mapContactToQboContact(makeContact({ name: longName }), "customer");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(JournalEntrySyncError);
    const failure = (thrown as JournalEntrySyncError).failure;
    expect(failure.errorCode).toBe("NAME_TOO_LONG");
    expect(failure.warning).toBe(true);
    expect(failure.metadata?.maxLength).toBe(100);
    expect(isJournalEntrySyncFailure(failure)).toBe(true);
  });

  it("allows exactly 100 characters", () => {
    const name = "x".repeat(QBO_NAME_MAX_LENGTH);
    expect(
      mapContactToQboContact(makeContact({ name }), "customer").DisplayName
    ).toBe(name);
  });
});

describe("mapQboContactToLocal (to-local fixture)", () => {
  const remote: Qbo.Customer = {
    Id: "42",
    SyncToken: "3",
    DisplayName: "Acme Manufacturing",
    PrimaryEmailAddr: { Address: "ap@acme.example" },
    PrimaryPhone: { FreeFormNumber: "555-0100" },
    BillAddr: {
      Line1: "1 Factory Way",
      City: "Cleveland",
      CountrySubDivisionCode: "OH",
      Country: "US",
      PostalCode: "44101"
    },
    Active: true,
    MetaData: { LastUpdatedTime: "2026-07-01T13:07:59-07:00" }
  };

  it("maps DisplayName/email/phone/BillAddr back with customer flags", () => {
    const local = mapQboContactToLocal(remote, {
      isCustomer: true,
      isVendor: false
    });

    expect(local.name).toBe("Acme Manufacturing");
    expect(local.email).toBe("ap@acme.example");
    expect(local.workPhone).toBe("555-0100");
    expect(local.isCustomer).toBe(true);
    expect(local.isVendor).toBe(false);
    expect(local.addresses).toEqual([
      {
        label: null,
        type: "BILLING",
        line1: "1 Factory Way",
        line2: null,
        city: "Cleveland",
        region: "OH",
        country: "US",
        postalCode: "44101"
      }
    ]);
  });

  it("sets vendor flags for the vendor syncer and handles a bare contact", () => {
    const local = mapQboContactToLocal(
      { Id: "9", SyncToken: "0", DisplayName: "Bare Vendor" },
      { isCustomer: false, isVendor: true }
    );

    expect(local.name).toBe("Bare Vendor");
    expect(local.isVendor).toBe(true);
    expect(local.isCustomer).toBe(false);
    expect(local.email).toBeUndefined();
    expect(local.workPhone).toBeNull();
    expect(local.addresses).toEqual([]);
  });
});

describe("toQboNameExistsError (Duplicate Name Exists → NAME_EXISTS Warning)", () => {
  it("converts an Intuit 6240 fault into the structured NAME_EXISTS Warning envelope", () => {
    const fault = makeQboFaultError(
      QBO_FAULT_CODES.DUPLICATE_NAME_EXISTS,
      "Duplicate Name Exists Error"
    );

    const converted = toQboNameExistsError(fault, {
      entityLabel: "customer",
      name: "Acme Manufacturing"
    });

    expect(converted).toBeInstanceOf(JournalEntrySyncError);
    expect(converted?.failure.errorCode).toBe("NAME_EXISTS");
    expect(converted?.failure.warning).toBe(true);
    expect(converted?.failure.metadata?.name).toBe("Acme Manufacturing");
    // The drain detects this envelope generically
    expect(isJournalEntrySyncFailure(converted?.failure)).toBe(true);
    // String-flattening paths stay greppable
    expect(converted?.message).toMatch(/^NAME_EXISTS: /);
  });

  it("returns null for any other fault or error", () => {
    expect(
      toQboNameExistsError(makeQboFaultError("5010", "Stale Object Error"), {
        entityLabel: "customer",
        name: "Acme"
      })
    ).toBeNull();
    expect(
      toQboNameExistsError(new Error("boom"), {
        entityLabel: "customer",
        name: "Acme"
      })
    ).toBeNull();
  });
});

describe("updateWithSyncTokenRetry (stale SyncToken → ONE refetch-and-retry)", () => {
  it("updates with the freshly fetched token on the happy path", async () => {
    const fetchCurrent = vi.fn(async () => ({ SyncToken: "4" }));
    const update = vi.fn(async (syncToken: string) => ({
      Id: "42",
      syncToken
    }));

    const result = await updateWithSyncTokenRetry({
      entityLabel: "customer",
      remoteId: "42",
      fetchCurrent,
      update
    });

    expect(result).toEqual({ Id: "42", syncToken: "4" });
    expect(fetchCurrent).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("4");
  });

  it("refetches and retries exactly once on a stale-token fault (5010)", async () => {
    const tokens = ["1", "2"];
    const fetchCurrent = vi.fn(async () => ({ SyncToken: tokens.shift()! }));
    const update = vi
      .fn<(syncToken: string) => Promise<{ Id: string }>>()
      .mockRejectedValueOnce(
        makeQboFaultError(QBO_FAULT_CODES.STALE_OBJECT, "Stale Object Error")
      )
      .mockResolvedValueOnce({ Id: "42" });

    const result = await updateWithSyncTokenRetry({
      entityLabel: "customer",
      remoteId: "42",
      fetchCurrent,
      update
    });

    expect(result).toEqual({ Id: "42" });
    expect(fetchCurrent).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenNthCalledWith(1, "1");
    expect(update).toHaveBeenNthCalledWith(2, "2");
  });

  it("propagates a second stale-token fault instead of retrying again", async () => {
    const staleError = makeQboFaultError(
      QBO_FAULT_CODES.STALE_OBJECT,
      "Stale Object Error"
    );
    const fetchCurrent = vi.fn(async () => ({ SyncToken: "1" }));
    const update = vi.fn(async () => {
      throw staleError;
    });

    await expect(
      updateWithSyncTokenRetry({
        entityLabel: "customer",
        remoteId: "42",
        fetchCurrent,
        update
      })
    ).rejects.toBe(staleError);

    expect(update).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-stale errors", async () => {
    const fault = makeQboFaultError(
      QBO_FAULT_CODES.DUPLICATE_NAME_EXISTS,
      "Duplicate Name Exists Error"
    );
    const fetchCurrent = vi.fn(async () => ({ SyncToken: "1" }));
    const update = vi.fn(async () => {
      throw fault;
    });

    await expect(
      updateWithSyncTokenRetry({
        entityLabel: "customer",
        remoteId: "42",
        fetchCurrent,
        update
      })
    ).rejects.toBe(fault);

    expect(fetchCurrent).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });
});

// =====================================================================
// Structured-failure survival through the push workflow: the base
// workflow flattens throws to strings; QboEntitySyncer must return the
// JournalEntrySyncFailure object on SyncResult.error instead.
// =====================================================================

type PushBehavior = {
  upsertError?: unknown;
  existingMapping?: { externalId: string; lastSyncedAt: string } | null;
};

class TestContactSyncer extends QboEntitySyncer<
  Accounting.Contact,
  Qbo.Customer
> {
  constructor(
    context: SyncContext,
    private behavior: PushBehavior
  ) {
    super(context);
    // The mapping service is backed by the (fake) database — stub the one
    // read the push workflow performs.
    (this as any).mappingService = {
      getByEntity: async () => this.behavior.existingMapping ?? null
    };
  }

  async fetchLocal(): Promise<Accounting.Contact | null> {
    return makeContact();
  }

  protected async fetchLocalBatch(): Promise<Map<string, Accounting.Contact>> {
    return new Map([["cust-1", makeContact()]]);
  }

  async fetchRemote(): Promise<Qbo.Customer | null> {
    return null;
  }

  protected async fetchRemoteBatch(): Promise<Map<string, Qbo.Customer>> {
    return new Map();
  }

  protected async mapToRemote(
    local: Accounting.Contact
  ): Promise<Omit<Qbo.Customer, QboWriteOmit>> {
    return mapContactToQboContact(local, "customer");
  }

  protected async mapToLocal(): Promise<Partial<Accounting.Contact>> {
    return {};
  }

  protected async upsertLocal(): Promise<string> {
    return "cust-1";
  }

  protected async upsertRemote(): Promise<string> {
    if (this.behavior.upsertError) throw this.behavior.upsertError;
    return "42";
  }
}

function makeSyncer(behavior: PushBehavior): TestContactSyncer {
  const context: SyncContext = {
    database: {} as SyncContext["database"],
    companyId: "company-1",
    provider: { id: "quickbooks" } as SyncContext["provider"],
    config: { enabled: true, direction: "two-way", owner: "accounting" },
    entityType: "customer"
  };
  return new TestContactSyncer(context, behavior);
}

describe("QboEntitySyncer push workflow (structured failures survive)", () => {
  it("returns the NAME_EXISTS envelope on SyncResult.error, not a flattened string", async () => {
    const fault = makeQboFaultError(
      QBO_FAULT_CODES.DUPLICATE_NAME_EXISTS,
      "Duplicate Name Exists Error"
    );
    const structured = toQboNameExistsError(fault, {
      entityLabel: "customer",
      name: "Acme Manufacturing"
    });

    const syncer = makeSyncer({ upsertError: structured });
    const result = await syncer.pushToAccounting("cust-1");

    expect(result.status).toBe("error");
    expect(typeof result.error).toBe("object");
    expect(isJournalEntrySyncFailure(result.error)).toBe(true);
    expect((result.error as { errorCode: string }).errorCode).toBe(
      "NAME_EXISTS"
    );
    expect((result.error as { warning: boolean }).warning).toBe(true);
  });

  it("returns the NAME_TOO_LONG envelope thrown from the mapping step", async () => {
    const syncer = makeSyncer({});
    (syncer as any).fetchLocal = async () =>
      makeContact({ name: "x".repeat(101) });

    const result = await syncer.pushToAccounting("cust-1");

    expect(result.status).toBe("error");
    expect(isJournalEntrySyncFailure(result.error)).toBe(true);
    expect((result.error as { errorCode: string }).errorCode).toBe(
      "NAME_TOO_LONG"
    );
  });

  it("keeps the base flattened-string behavior for plain errors", async () => {
    const syncer = makeSyncer({ upsertError: new Error("boom") });
    const result = await syncer.pushToAccounting("cust-1");

    expect(result.status).toBe("error");
    expect(result.error).toBe("boom");
  });

  it("keeps the base fast bailout: mapped + unchanged local skips", async () => {
    const syncer = makeSyncer({
      existingMapping: {
        externalId: "42",
        lastSyncedAt: "2026-07-02T00:00:00.000Z" // after the fixture's updatedAt
      }
    });

    const result = await syncer.pushToAccounting("cust-1");

    expect(result.status).toBe("skipped");
    expect(result.remoteId).toBe("42");
    expect(result.error).toBe("Already synced - local unchanged");
  });

  it("preserves the envelope through the batch path (drain uses pushBatchToAccounting)", async () => {
    const fault = makeQboFaultError(
      QBO_FAULT_CODES.DUPLICATE_NAME_EXISTS,
      "Duplicate Name Exists Error"
    );
    const structured = toQboNameExistsError(fault, {
      entityLabel: "customer",
      name: "Acme Manufacturing"
    });

    const syncer = makeSyncer({ upsertError: structured });
    const batch = await syncer.pushBatchToAccounting(["cust-1"]);

    expect(batch.errorCount).toBe(1);
    expect(isJournalEntrySyncFailure(batch.results[0]?.error)).toBe(true);
  });
});
