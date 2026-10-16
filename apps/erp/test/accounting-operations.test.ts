// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it, vi } from "vitest";

// The module's imports reach the glossary, whose `msg` macro only runs compiled.
vi.mock("@lingui/core/macro", () => ({
  msg: (strings: TemplateStringsArray) => ({ id: strings.join("") })
}));

import {
  accountMove,
  depreciationRunCreate,
  exchangeRateOverride,
  fixedAssetDispose,
  fixedAssetSell,
  fixedAssetTakeOutOfService,
  journalEntrySave
} from "../app/modules/accounting/accounting.server";
import { createServiceContext } from "@carbon/api/service-fn.server";

/** A client whose every read of a table answers `rows[table]`. It has no
 *  write methods, so a test that gets past the refusal to a write fails. */
function reading(rows: Record<string, unknown>) {
  return {
    from: (table: string) => {
      const result = { data: rows[table] ?? null, error: null };
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        single: async () => result,
        maybeSingle: async () => result,
        then: (resolve: (value: typeof result) => void) => resolve(result)
      };
      return chain;
    }
  } as any;
}

// A client with no methods: any read through it fails the test.
const noClient = () => ({}) as any;

const unreachable = () => {
  throw new Error("must not be reached");
};

const allActions = {
  view: ["company-1"],
  create: ["company-1"],
  update: ["company-1"],
  delete: ["company-1"]
};

function contextFor(caller: any, system: () => any = noClient) {
  return createServiceContext({
    actor: {
      type: "user",
      userId: "user-1",
      permissions: { accounting: allActions, sales: allActions }
    },
    company: { id: "company-1", groupId: "group-1" },
    caller,
    system,
    pg: unreachable,
    kv: unreachable
  });
}

const line = (debit: number, credit: number, accountId = "acc-1") => ({
  accountId,
  debit,
  credit
});

describe("journalEntrySave", () => {
  it("refuses a line with both a debit and a credit, before saving", async () => {
    const result = await journalEntrySave(contextFor(noClient()), {
      journalEntryId: "je-1",
      postingDate: "2026-10-01",
      lines: [line(10, 0), line(5, 5)]
    });
    expect(result.error).toMatchObject({
      category: "validation",
      message: "Each line must have either a debit or credit amount"
    });
  });

  it("refuses a line with no account", async () => {
    const result = await journalEntrySave(contextFor(noClient()), {
      journalEntryId: "je-1",
      postingDate: "2026-10-01",
      lines: [line(10, 0, "")]
    });
    expect(result.error).toMatchObject({
      message: "Each line must have an account"
    });
  });
});

describe("accountMove", () => {
  // 1000 Assets ⊃ 1100 Current Assets ⊃ 1110 Cash (a leaf)
  const chart = [
    {
      id: "assets",
      parentId: null,
      isGroup: true,
      class: "Asset",
      incomeBalance: "Balance Sheet"
    },
    {
      id: "current",
      parentId: "assets",
      isGroup: true,
      class: "Asset",
      incomeBalance: "Balance Sheet"
    },
    {
      id: "cash",
      parentId: "current",
      isGroup: false,
      class: "Asset",
      incomeBalance: "Balance Sheet"
    }
  ];

  it("refuses to move a group under one of its own accounts", async () => {
    const result = await accountMove(contextFor(reading({ account: chart })), {
      accountId: "assets",
      parentId: "current"
    });
    expect(result.error).toMatchObject({
      category: "rule",
      message: "An account cannot move under itself or one of its own accounts"
    });
  });

  it("refuses a parent that is not a group", async () => {
    const result = await accountMove(contextFor(reading({ account: chart })), {
      accountId: "current",
      parentId: "cash"
    });
    expect(result.error).toMatchObject({
      category: "rule",
      message: "Choose a group account to move it under"
    });
  });
});

describe("fixedAssetDispose", () => {
  it("refuses an asset that is already disposed, before posting", async () => {
    const result = await fixedAssetDispose(
      contextFor(
        reading({
          fixedAsset: { status: "Disposed", fixedAssetClass: { id: "c" } },
          dimension: []
        })
      ),
      { fixedAssetId: "fa-1", disposalDate: "2026-10-01" }
    );
    expect(result.error).toMatchObject({
      category: "rule",
      message: "Only Active or Fully Depreciated assets can be disposed"
    });
  });
});

describe("fixedAssetSell", () => {
  it("refuses a Draft asset, before creating an order", async () => {
    const result = await fixedAssetSell(
      contextFor(
        reading({ fixedAsset: { status: "Draft" }, userDefaults: null })
      ),
      { fixedAssetId: "fa-1", customerId: "cust-1" }
    );
    expect(result.error).toMatchObject({
      category: "rule",
      message: "Only active assets can be sold"
    });
  });
});

describe("fixedAssetTakeOutOfService", () => {
  it("refuses a unit on rent, read with the service role", async () => {
    const result = await fixedAssetTakeOutOfService(
      contextFor(
        reading({
          fixedAsset: { status: "Active", outOfServiceSince: null }
        }),
        () =>
          reading({
            rentalAgreementLine: {
              id: "ral-1",
              rentalAgreement: { id: "ra-1", rentalAgreementId: "RA000001" }
            }
          })
      ),
      { fixedAssetId: "fa-1", reason: "Broken" }
    );
    expect(result.error).toMatchObject({
      category: "rule",
      message:
        "The asset is on rent on RA000001; return it from the agreement and take it out of service there"
    });
  });

  it("refuses an asset already out of service", async () => {
    const result = await fixedAssetTakeOutOfService(
      contextFor(
        reading({
          fixedAsset: { status: "Active", outOfServiceSince: "2026-09-01" }
        })
      ),
      { fixedAssetId: "fa-1", reason: "Broken" }
    );
    expect(result.error).toMatchObject({
      message: "The asset is already out of service"
    });
  });
});

describe("exchangeRateOverride", () => {
  it("refuses to pin the base currency", async () => {
    const result = await exchangeRateOverride(
      contextFor(reading({ company: { baseCurrencyCode: "USD" } })),
      { currencyCode: "USD", rate: 1.1 }
    );
    expect(result.error).toMatchObject({
      category: "rule",
      message: "The base currency's exchange rate is always 1"
    });
  });
});

describe("depreciationRunCreate", () => {
  it("refuses a period that does not end after the last run", async () => {
    const result = await depreciationRunCreate(
      contextFor(
        reading({ depreciationRun: [{ periodEnd: "2026-09-30" }] })
      ),
      { periodEnd: "2026-08-15" }
    );
    expect(result.error).toMatchObject({
      category: "rule",
      message: "The period must end after the last depreciation run"
    });
  });
});
