import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  isJournalEntrySyncFailure,
  JournalEntrySyncError
} from "../../../../core/posting";
import type { Accounting } from "../../../../core/types";
import { AccountingApiError } from "../../../../core/utils";
import type { Qbo, QboCreatePayload } from "../../models";
import { mapItemToQboItem, QboItemSyncer } from "../item";

const makeItem = (overrides?: Partial<Accounting.Item>): Accounting.Item => ({
  id: "item-1",
  code: "PART-000123",
  name: "Widget Bracket",
  description: "Steel bracket for widgets",
  companyId: "company-1",
  type: "Part",
  unitOfMeasureCode: "EA",
  unitCost: 4.25,
  unitSalePrice: 9.99,
  isPurchased: true,
  isSold: true,
  isTrackedAsInventory: true,
  updatedAt: "2026-07-01T12:00:00.000Z",
  raw: {},
  ...overrides
});

const ACCOUNT_REFS: ReadonlyMap<string, Qbo.Ref> = new Map([
  ["acc-sales", { value: "79", name: "Sales of Product Income" }],
  ["acc-cogs", { value: "80", name: "Cost of Goods Sold" }]
]);

const passingArgs = () => ({
  item: makeItem(),
  accountRefsById: ACCOUNT_REFS,
  incomeAccountId: "acc-sales" as string | null,
  expenseAccountId: "acc-cogs" as string | null
});

describe("mapItemToQboItem (mapping fixture with account resolution)", () => {
  it("maps a purchased physical item to NonInventory with both account refs", () => {
    const payload = mapItemToQboItem(passingArgs());

    expect(payload).toEqual({
      Name: "PART-000123",
      Description: "Steel bracket for widgets",
      Type: "NonInventory",
      Active: true,
      UnitPrice: 9.99,
      PurchaseCost: 4.25,
      IncomeAccountRef: { value: "79", name: "Sales of Product Income" },
      ExpenseAccountRef: { value: "80", name: "Cost of Goods Sold" }
    });
  });

  it("maps Carbon Service items to QBO Type Service", () => {
    const payload = mapItemToQboItem({
      ...passingArgs(),
      item: makeItem({ type: "Service", isPurchased: false })
    });

    expect(payload.Type).toBe("Service");
    expect(payload.ExpenseAccountRef).toBeUndefined();
  });

  it("never produces Type Inventory for any Carbon item type (double-COGS guard)", () => {
    const types: Accounting.Item["type"][] = [
      "Part",
      "Material",
      "Tool",
      "Service",
      "Consumable",
      "Fixture"
    ];

    for (const type of types) {
      const payload = mapItemToQboItem({
        ...passingArgs(),
        item: makeItem({ type })
      });
      expect(["Service", "NonInventory"]).toContain(payload.Type);
    }
  });

  it("omits ExpenseAccountRef (and skips its mapping requirement) for non-purchased items", () => {
    const payload = mapItemToQboItem({
      ...passingArgs(),
      item: makeItem({ isPurchased: false }),
      expenseAccountId: null
    });

    expect(payload.ExpenseAccountRef).toBeUndefined();
    expect(payload.IncomeAccountRef).toEqual({
      value: "79",
      name: "Sales of Product Income"
    });
  });

  it("falls back to the item name when there is no description", () => {
    const payload = mapItemToQboItem({
      ...passingArgs(),
      item: makeItem({ description: null })
    });

    expect(payload.Description).toBe("Widget Bracket");
  });

  it("throws the structured UNMAPPED_ACCOUNTS Warning when a required account has no mapping", () => {
    let thrown: unknown;
    try {
      mapItemToQboItem({
        ...passingArgs(),
        accountRefsById: new Map([
          ["acc-cogs", { value: "80" } satisfies Qbo.Ref]
        ])
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(JournalEntrySyncError);
    const failure = (thrown as JournalEntrySyncError).failure;
    expect(failure.errorCode).toBe("UNMAPPED_ACCOUNTS");
    expect(failure.warning).toBe(true);
    expect(failure.metadata?.unmappedAccountIds).toEqual(["acc-sales"]);
    expect(isJournalEntrySyncFailure(failure)).toBe(true);
  });

  it("collects both unmapped accounts when neither default is mapped", () => {
    let thrown: unknown;
    try {
      mapItemToQboItem({ ...passingArgs(), accountRefsById: new Map() });
    } catch (error) {
      thrown = error;
    }

    const failure = (thrown as JournalEntrySyncError).failure;
    expect(failure.errorCode).toBe("UNMAPPED_ACCOUNTS");
    expect(failure.metadata?.unmappedAccountIds).toEqual([
      "acc-sales",
      "acc-cogs"
    ]);
  });

  it("reports missing accountDefault columns as UNMAPPED_ACCOUNTS with missingDefaults metadata", () => {
    let thrown: unknown;
    try {
      mapItemToQboItem({
        ...passingArgs(),
        incomeAccountId: null,
        expenseAccountId: null
      });
    } catch (error) {
      thrown = error;
    }

    const failure = (thrown as JournalEntrySyncError).failure;
    expect(failure.errorCode).toBe("UNMAPPED_ACCOUNTS");
    expect(failure.metadata?.missingDefaults).toEqual([
      "salesAccount",
      "costOfGoodsSoldAccount"
    ]);
  });

  it("throws the structured NAME_TOO_LONG Warning past QBO's 100-char Name cap", () => {
    let thrown: unknown;
    try {
      mapItemToQboItem({
        ...passingArgs(),
        item: makeItem({ code: "P".repeat(101) })
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(JournalEntrySyncError);
    const failure = (thrown as JournalEntrySyncError).failure;
    expect(failure.errorCode).toBe("NAME_TOO_LONG");
    expect(failure.warning).toBe(true);
    expect(isJournalEntrySyncFailure(failure)).toBe(true);
  });
});

const { shippingLinks, linkControl } = vi.hoisted(() => ({
  shippingLinks: [] as Array<Record<string, unknown>>,
  linkControl: { failOnce: false }
}));
vi.mock("../../../../core/utils", async (original) => ({
  ...(await original<typeof import("../../../../core/utils")>()),
  withTriggersDisabled: async (
    _database: unknown,
    callback: (tx: unknown) => Promise<unknown>
  ) => {
    const builder: any = {
      values(values: Record<string, unknown>) {
        shippingLinks.push(values);
        return builder;
      },
      onConflict() {
        return builder;
      },
      async execute() {
        if (linkControl.failOnce) {
          linkControl.failOnce = false;
          throw new Error("link failed");
        }
        return [];
      }
    };
    return callback({ insertInto: () => builder });
  }
}));
beforeEach(() => {
  shippingLinks.length = 0;
  linkControl.failOnce = false;
});
const shippingItem = (overrides: Partial<Qbo.Item> = {}): Qbo.Item => ({
  Id: "shipping-remote",
  SyncToken: "1",
  Name: "Carbon Shipping acct-shipping",
  Type: "Service",
  Active: true,
  UnitPrice: 0,
  IncomeAccountRef: { value: "income-shipping" },
  ...overrides
});
function shippingSyncer(
  args: {
    existingId?: string;
    existing?: Qbo.Item;
    matches?: Qbo.Item[];
    create?: ReturnType<typeof vi.fn>;
    refs?: Map<string, Qbo.Ref>;
  } = {}
) {
  const query = vi.fn(
    async (_entity: string, _where?: string) => args.matches ?? []
  );
  const getItem = vi.fn(async () => args.existing ?? shippingItem());
  const createItem =
    args.create ??
    vi.fn(async (_payload: QboCreatePayload<Qbo.Item>) => shippingItem());
  const updateItem = vi.fn(async (payload: Qbo.Item) => payload);
  const syncer = new QboItemSyncer({
    database: {} as never,
    companyId: "company-1",
    provider: {
      id: "quickbooks",
      query,
      getItem,
      createItem,
      updateItem
    } as never,
    config: { enabled: true, direction: "push-to-accounting", owner: "carbon" },
    entityType: "item"
  });
  (syncer as any).mappingService = {
    getExternalId: vi.fn(async () => args.existingId ?? null)
  };
  (syncer as any).getAccountRefsById = async () =>
    args.refs ?? new Map([["acct-shipping", { value: "income-shipping" }]]);
  return { syncer, query, getItem, createItem, updateItem };
}
describe("QBO shipping helper identity", () => {
  it("creates one sales-only Service per shipping account and caches reuse", async () => {
    const test = shippingSyncer();
    expect(
      await test.syncer.ensureShippingItem({
        shippingAccountId: "acct-shipping"
      })
    ).toBe("shipping-remote");
    expect(
      await test.syncer.ensureShippingItem({
        shippingAccountId: "acct-shipping"
      })
    ).toBe("shipping-remote");
    expect(test.createItem).toHaveBeenCalledOnce();
    expect(test.createItem.mock.calls[0]?.[0]).toEqual({
      Name: "Carbon Shipping acct-shipping",
      Description: "Customer shipping charges",
      Type: "Service",
      Active: true,
      UnitPrice: 0,
      IncomeAccountRef: { value: "income-shipping" }
    });
    expect(shippingLinks[0]).toMatchObject({
      entityType: "shippingItem",
      entityId: "acct-shipping",
      integration: "quickbooks",
      externalId: "shipping-remote",
      companyId: "company-1",
      metadata: { accountId: "acct-shipping", kind: "shipping" }
    });
    expect(test.query).toHaveBeenCalledOnce();
  });
  it("reuses an owned compatible helper mapping without a create or name lookup", async () => {
    const test = shippingSyncer({ existingId: "shipping-remote" });
    expect(
      await test.syncer.ensureShippingItem({
        shippingAccountId: "acct-shipping"
      })
    ).toBe("shipping-remote");
    expect(test.createItem).not.toHaveBeenCalled();
    expect(test.query).not.toHaveBeenCalled();
  });
  it("recovers remote-create/local-link retries through the exact compatible remote name", async () => {
    const test = shippingSyncer();
    linkControl.failOnce = true;
    await expect(
      test.syncer.ensureShippingItem({ shippingAccountId: "acct-shipping" })
    ).rejects.toThrow("link failed");
    test.query.mockResolvedValue([shippingItem()]);
    expect(
      await test.syncer.ensureShippingItem({
        shippingAccountId: "acct-shipping"
      })
    ).toBe("shipping-remote");
    expect(test.createItem).toHaveBeenCalledOnce();
    expect(test.query.mock.calls[1]).toEqual([
      "Item",
      "Name = 'Carbon Shipping acct-shipping'"
    ]);
  });
  it("recovers duplicate-name races by rereading and linking the compatible helper", async () => {
    const error = new AccountingApiError("quickbooks", "create item", {
      statusCode: 400,
      statusText: "Bad Request",
      providerErrorCode: "6240"
    });
    const test = shippingSyncer({
      create: vi.fn(async () => {
        throw error;
      })
    });
    test.query
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([shippingItem()]);
    expect(
      await test.syncer.ensureShippingItem({
        shippingAccountId: "acct-shipping"
      })
    ).toBe("shipping-remote");
    expect(test.createItem).toHaveBeenCalledOnce();
    expect(shippingLinks).toHaveLength(1);
  });
  it.each([
    { Type: "NonInventory" },
    { Active: false },
    { IncomeAccountRef: { value: "wrong" } }
  ])("refuses an incompatible unowned helper without mutating it: %s", async (override) => {
    const test = shippingSyncer({
      matches: [shippingItem(override as Partial<Qbo.Item>)]
    });
    await expect(
      test.syncer.ensureShippingItem({ shippingAccountId: "acct-shipping" })
    ).rejects.toMatchObject({
      failure: { errorCode: "UNMAPPED_ACCOUNTS", warning: true }
    });
    expect(test.createItem).not.toHaveBeenCalled();
    expect(test.updateItem).not.toHaveBeenCalled();
    expect(shippingLinks).toEqual([]);
  });
  it("reconverges only an owned helper with the current SyncToken", async () => {
    const test = shippingSyncer({
      existingId: "shipping-remote",
      existing: shippingItem({ IncomeAccountRef: { value: "old-account" } })
    });
    expect(
      await test.syncer.ensureShippingItem({
        shippingAccountId: "acct-shipping"
      })
    ).toBe("shipping-remote");
    expect(test.updateItem).toHaveBeenCalledWith(
      expect.objectContaining({
        Id: "shipping-remote",
        SyncToken: "1",
        IncomeAccountRef: { value: "income-shipping" }
      })
    );
    expect(test.createItem).not.toHaveBeenCalled();
    expect(test.query).not.toHaveBeenCalled();
  });
  it("keeps an owned helper nominally priced at zero", async () => {
    const test = shippingSyncer({
      existingId: "shipping-remote",
      existing: shippingItem({ UnitPrice: 9 })
    });
    await test.syncer.ensureShippingItem({
      shippingAccountId: "acct-shipping"
    });
    expect(test.updateItem).toHaveBeenCalledWith(
      expect.objectContaining({ UnitPrice: 0 })
    );
  });
  it("fails unmapped shipping before remote reads/writes", async () => {
    const test = shippingSyncer({ refs: new Map() });
    await expect(
      test.syncer.ensureShippingItem({ shippingAccountId: "acct-shipping" })
    ).rejects.toMatchObject({
      failure: { errorCode: "UNMAPPED_ACCOUNTS", warning: true }
    });
    expect(test.query).not.toHaveBeenCalled();
    expect(test.createItem).not.toHaveBeenCalled();
  });
});
