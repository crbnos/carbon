import { describe, expect, it } from "vitest";
import {
  isJournalEntrySyncFailure,
  JournalEntrySyncError
} from "../../../../core/posting";
import type { Accounting } from "../../../../core/types";
import type { Qbo } from "../../models";
import { mapItemToQboItem } from "../item";

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
