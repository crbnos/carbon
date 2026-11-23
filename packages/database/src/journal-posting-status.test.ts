// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  DOCUMENT_JOURNAL_STATUSES,
  GL_JOURNAL_STATUSES,
  OPEN_ITEM_JOURNAL_STATUSES
} from "./accounting-posting.ts";
import {
  assertPostingStatusUnchanged,
  configuredDefaultAccount,
  MissingAccountDefaultError,
  OPTIONAL_DEFAULT_ROLES,
  POSTING_STATUS_CHANGED_ERROR,
  postingStatusFor,
  resolveDefaultAccount
} from "./journal-posting-status.ts";

describe("postingStatusFor", () => {
  it("is Provisional before the cutover and Posted after it", () => {
    expect(postingStatusFor(null)).toBe("Provisional");
    expect(postingStatusFor("2026-10-01")).toBe("Posted");
  });
});

describe("journal status lists", () => {
  it("lets no reader count a Superseded journal, and no GL reader a Provisional one", () => {
    expect([...GL_JOURNAL_STATUSES]).toEqual(["Posted", "Reversed"]);
    expect([...DOCUMENT_JOURNAL_STATUSES]).toEqual([
      "Provisional",
      "Posted",
      "Reversed"
    ]);
    expect([...OPEN_ITEM_JOURNAL_STATUSES]).toEqual(["Provisional", "Posted"]);
  });
});

describe("resolveDefaultAccount", () => {
  const defaults = {
    retainedEarningsAccount: "acct-retained",
    salesAccount: "acct-sales",
    inventoryAdjustmentVarianceAccount: "acct-variance",
    scrapAccount: "acct-scrap",
    salesReturnsAccount: null,
    laborAbsorptionAccount: null
  };

  it("uses a set default as is", () => {
    expect(resolveDefaultAccount(defaults, "scrapAccount", "Posted")).toEqual({
      accountId: "acct-scrap",
      accountDefaultRole: null
    });
  });

  it("stands in retained earnings for an empty default before the cutover", () => {
    expect(
      resolveDefaultAccount(defaults, "laborAbsorptionAccount", "Provisional")
    ).toEqual({
      accountId: "acct-retained",
      accountDefaultRole: "laborAbsorptionAccount"
    });
  });

  it("uses the fallback of an empty default in both states, with no stand-in", () => {
    for (const status of ["Provisional", "Posted"] as const) {
      expect(
        resolveDefaultAccount(defaults, "salesReturnsAccount", status)
      ).toEqual({ accountId: "acct-sales", accountDefaultRole: null });
      expect(
        resolveDefaultAccount(
          { ...defaults, scrapAccount: null },
          "scrapAccount",
          status
        )
      ).toEqual({ accountId: "acct-variance", accountDefaultRole: null });
    }
    expect(
      configuredDefaultAccount(
        { ...defaults, payablesAccount: "acct-ap" },
        "intercompanyPayablesAccount"
      )
    ).toBe("acct-ap");
    expect(configuredDefaultAccount(defaults, "laborAbsorptionAccount")).toBe(
      null
    );
  });

  it("refuses an empty default after the cutover with a 400 that names it as the page does", () => {
    let error: unknown;
    try {
      resolveDefaultAccount(defaults, "laborAbsorptionAccount", "Posted");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(MissingAccountDefaultError);
    expect(error).toMatchObject({
      status: 400,
      role: "laborAbsorptionAccount",
      message:
        "Set the Labor & Machine Absorption account in Accounting → Default Accounts."
    });
  });

  it("names every optional default in plain words", () => {
    for (const role of OPTIONAL_DEFAULT_ROLES) {
      expect(new MissingAccountDefaultError(role).message).not.toContain(role);
    }
  });
});

describe("assertPostingStatusUnchanged", () => {
  // A transaction stand-in whose companySettings read returns `cutoverDate`.
  const trxReading = (cutoverDate: string | null) =>
    ({
      selectFrom: () => ({
        select: () => ({
          where: () => ({
            forShare: () => ({
              executeTakeFirst: async () => ({
                accountingCutoverDate: cutoverDate
              })
            })
          })
        })
      })
    }) as unknown as Parameters<typeof assertPostingStatusUnchanged>[0];

  it("passes when the status inside the transaction is the one read before it", async () => {
    await expect(
      assertPostingStatusUnchanged(trxReading(null), "c", "Provisional")
    ).resolves.toBeUndefined();
    await expect(
      assertPostingStatusUnchanged(trxReading("2026-10-01"), "c", "Posted")
    ).resolves.toBeUndefined();
  });

  it("refuses when the enable committed between the two reads", async () => {
    await expect(
      assertPostingStatusUnchanged(trxReading("2026-10-01"), "c", "Provisional")
    ).rejects.toThrow(POSTING_STATUS_CHANGED_ERROR);
  });
});
