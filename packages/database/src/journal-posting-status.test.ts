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
    scrapAccount: "acct-scrap",
    salesReturnsAccount: null
  };

  it("uses a set default as is", () => {
    expect(resolveDefaultAccount(defaults, "scrapAccount", "Posted")).toEqual({
      accountId: "acct-scrap",
      accountDefaultRole: null
    });
  });

  it("stands in retained earnings for an empty default before the cutover", () => {
    expect(
      resolveDefaultAccount(defaults, "salesReturnsAccount", "Provisional")
    ).toEqual({
      accountId: "acct-retained",
      accountDefaultRole: "salesReturnsAccount"
    });
  });

  it("refuses an empty default after the cutover", () => {
    expect(() =>
      resolveDefaultAccount(defaults, "salesReturnsAccount", "Posted")
    ).toThrow("Set the salesReturnsAccount account default");
  });
});
