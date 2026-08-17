import { describe, expect, it } from "vitest";
import {
  buildAccountMappingMetadata,
  collectAccountDefaultAccountIds,
  getAccountMappingDisplayMetadata,
  proposeAccountMatchesByCode
} from "./account-mapping";

describe("collectAccountDefaultAccountIds", () => {
  it("collects ids from *Account and *AccountId columns only", () => {
    const ids = collectAccountDefaultAccountIds({
      companyId: "company-1",
      updatedBy: "user-1",
      salesAccount: "acc-sales",
      inventoryAccount: "acc-inventory",
      receivablesAccount: "acc-ar",
      deferredTaxExpenseAccountId: "acc-deferred-tax",
      intercompanyReceivablesAccount: null
    });

    expect(ids.sort()).toEqual([
      "acc-ar",
      "acc-deferred-tax",
      "acc-inventory",
      "acc-sales"
    ]);
    // Non-account columns are never collected
    expect(ids).not.toContain("company-1");
    expect(ids).not.toContain("user-1");
  });

  it("dedupes when several defaults point at the same account", () => {
    const ids = collectAccountDefaultAccountIds({
      salesAccount: "acc-1",
      salesDiscountAccount: "acc-1",
      roundingAccount: "acc-2"
    });

    expect(ids.sort()).toEqual(["acc-1", "acc-2"]);
  });

  it("skips null and empty values and handles a missing row", () => {
    expect(
      collectAccountDefaultAccountIds({
        salesAccount: null,
        inventoryAccount: "",
        payablesAccount: "acc-ap"
      })
    ).toEqual(["acc-ap"]);
    expect(collectAccountDefaultAccountIds(null)).toEqual([]);
    expect(collectAccountDefaultAccountIds(undefined)).toEqual([]);
  });
});

describe("buildAccountMappingMetadata", () => {
  it("shapes provided fields into metadata", () => {
    expect(
      buildAccountMappingMetadata({
        externalCode: "200",
        externalName: "Sales"
      })
    ).toEqual({ externalCode: "200", externalName: "Sales" });
    expect(buildAccountMappingMetadata({ externalCode: "200" })).toEqual({
      externalCode: "200"
    });
    expect(buildAccountMappingMetadata({ externalName: "Sales" })).toEqual({
      externalName: "Sales"
    });
  });

  it("returns undefined when neither field is provided", () => {
    expect(buildAccountMappingMetadata({})).toBeUndefined();
    expect(
      buildAccountMappingMetadata({ externalCode: undefined })
    ).toBeUndefined();
  });
});

describe("getAccountMappingDisplayMetadata", () => {
  it("round-trips metadata written by buildAccountMappingMetadata", () => {
    const metadata = buildAccountMappingMetadata({
      externalCode: "200",
      externalName: "Sales"
    });

    expect(getAccountMappingDisplayMetadata(metadata)).toEqual({
      externalCode: "200",
      externalName: "Sales"
    });
  });

  it("returns nulls for missing or malformed metadata", () => {
    expect(getAccountMappingDisplayMetadata(null)).toEqual({
      externalCode: null,
      externalName: null
    });
    expect(getAccountMappingDisplayMetadata(undefined)).toEqual({
      externalCode: null,
      externalName: null
    });
    expect(getAccountMappingDisplayMetadata("garbage")).toEqual({
      externalCode: null,
      externalName: null
    });
    expect(getAccountMappingDisplayMetadata([1, 2])).toEqual({
      externalCode: null,
      externalName: null
    });
    expect(
      getAccountMappingDisplayMetadata({ externalCode: 200, externalName: {} })
    ).toEqual({ externalCode: null, externalName: null });
  });
});

describe("proposeAccountMatchesByCode", () => {
  const accounts = [
    { id: "acc-1", number: "1210", name: "Inventory" },
    { id: "acc-2", number: "4010", name: "Sales" },
    { id: "acc-3", number: "5010", name: "Cost of Goods Sold - Direct" }
  ];

  it("proposes exact number-to-code matches only", () => {
    const proposals = proposeAccountMatchesByCode({
      accounts,
      providerAccounts: [
        { id: "xero-1", code: "1210", name: "Inventory Asset" },
        { id: "xero-2", code: "4010 ", name: "Sales" }, // trailing space: not exact
        { id: "xero-3", code: "501", name: "COGS" } // prefix: not exact
      ]
    });

    expect(proposals).toEqual([
      {
        accountId: "acc-1",
        accountNumber: "1210",
        accountName: "Inventory",
        externalId: "xero-1",
        externalCode: "1210",
        externalName: "Inventory Asset"
      }
    ]);
  });

  it("proposes nothing when no code matches", () => {
    const proposals = proposeAccountMatchesByCode({
      accounts,
      providerAccounts: [{ id: "xero-1", code: "9999", name: "Other" }]
    });

    expect(proposals).toEqual([]);
  });

  it("skips Carbon accounts sharing a duplicate number", () => {
    const proposals = proposeAccountMatchesByCode({
      accounts: [
        { id: "acc-1", number: "1210", name: "Inventory A" },
        { id: "acc-2", number: "1210", name: "Inventory B" },
        { id: "acc-3", number: "4010", name: "Sales" }
      ],
      providerAccounts: [
        { id: "xero-1", code: "1210", name: "Inventory" },
        { id: "xero-2", code: "4010", name: "Sales" }
      ]
    });

    expect(proposals.map((p) => p.accountId)).toEqual(["acc-3"]);
  });

  it("skips provider codes offered by more than one provider account", () => {
    const proposals = proposeAccountMatchesByCode({
      accounts,
      providerAccounts: [
        { id: "xero-1", code: "1210", name: "Inventory A" },
        { id: "xero-2", code: "1210", name: "Inventory B" },
        { id: "xero-3", code: "4010", name: "Sales" }
      ]
    });

    expect(proposals.map((p) => p.externalId)).toEqual(["xero-3"]);
  });

  it("skips already-mapped accounts and already-used provider accounts", () => {
    const proposals = proposeAccountMatchesByCode({
      accounts,
      providerAccounts: [
        { id: "xero-1", code: "1210", name: "Inventory" },
        { id: "xero-2", code: "4010", name: "Sales" },
        { id: "xero-3", code: "5010", name: "COGS" }
      ],
      mappedAccountIds: ["acc-1"],
      mappedExternalIds: ["xero-2"]
    });

    expect(proposals.map((p) => p.accountId)).toEqual(["acc-3"]);
  });

  it("skips unnumbered accounts and uncoded provider accounts", () => {
    const proposals = proposeAccountMatchesByCode({
      accounts: [
        { id: "acc-1", number: null, name: "Group Header" },
        { id: "acc-2", number: "4010", name: "Sales" }
      ],
      providerAccounts: [
        { id: "xero-1", code: null, name: "Uncoded" },
        { id: "xero-2", name: "No code at all" },
        { id: "xero-3", code: "4010", name: "Sales" }
      ]
    });

    expect(proposals).toEqual([
      {
        accountId: "acc-2",
        accountNumber: "4010",
        accountName: "Sales",
        externalId: "xero-3",
        externalCode: "4010",
        externalName: "Sales"
      }
    ]);
  });
});
