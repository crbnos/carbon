// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { createServiceContext } from "@carbon/api/service-fn.server";
import { describe, expect, it } from "vitest";
import { saveJournalEntry } from "../app/modules/accounting/accounting.server";
import { accountMoveRefusal } from "../app/modules/accounting/accounting.utils";

// A handle with no methods: a refusal that reached the database fails the test.
const unreachable = () => {
  throw new Error("must not be reached");
};

const context = () =>
  createServiceContext({
    actor: {
      type: "user",
      userId: "user-1",
      permissions: {
        accounting: {
          view: ["company-1"],
          create: ["company-1"],
          update: ["company-1"],
          delete: ["company-1"]
        }
      }
    },
    company: { id: "company-1", groupId: "group-1" },
    caller: {} as never,
    system: unreachable,
    pg: unreachable,
    kv: unreachable
  });

const line = (debit: number, credit: number, accountId = "acc-1") => ({
  accountId,
  debit,
  credit
});

describe("saveJournalEntry", () => {
  it("refuses a line with both a debit and a credit, before saving", async () => {
    const result = await saveJournalEntry(context(), {
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
    const result = await saveJournalEntry(context(), {
      journalEntryId: "je-1",
      postingDate: "2026-10-01",
      lines: [line(10, 0, "")]
    });
    expect(result.error).toMatchObject({
      message: "Each line must have an account"
    });
  });
});

describe("moving an account", () => {
  // 1000 Assets ⊃ 1100 Current Assets ⊃ 1110 Cash (a leaf)
  const chart = [
    { id: "assets", parentId: null, isGroup: true },
    { id: "current", parentId: "assets", isGroup: true },
    { id: "cash", parentId: "current", isGroup: false }
  ];

  it("refuses to move a group under one of its own accounts", () => {
    expect(accountMoveRefusal(chart, "assets", "current")).toBe(
      "An account cannot move under itself or one of its own accounts"
    );
    expect(accountMoveRefusal(chart, "current", "current")).toBe(
      "An account cannot move under itself or one of its own accounts"
    );
  });

  it("refuses a parent that is not a group, or not in the chart", () => {
    expect(accountMoveRefusal(chart, "current", "cash")).toBe(
      "Choose a group account to move it under"
    );
    expect(accountMoveRefusal(chart, "cash", "elsewhere")).toBe(
      "Choose a group account to move it under"
    );
  });

  it("allows a move under another group", () => {
    expect(accountMoveRefusal(chart, "cash", "assets")).toBeNull();
  });
});
