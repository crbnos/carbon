// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { parseReferencePolicy } from "./account-references";

describe("parseReferencePolicy", () => {
  it("reads one-line and multi-line entries of REFERENCE_POLICY only", () => {
    const source = [
      'const OTHER = [{ table: "other", column: "x", policy: "repoint" }];',
      "export const REFERENCE_POLICY: readonly AccountReference[] = [",
      '  { table: "charge", column: "cardAccountId", policy: "repoint" },',
      "  {",
      '    table: "journalLine",',
      '    column: "accountId",',
      '    policy: "repoint-if-parent-status"',
      "  }",
      "];",
      'const LATER = [{ table: "later", column: "y" }];',
      "export const UNCLASSIFIED_ACCOUNT_REFERENCES: readonly string[] = [",
      '  "accountDefault",',
      '  "account.parentId"',
      "];"
    ].join("\n");
    const { classified, unclassified } = parseReferencePolicy(source);
    expect([...classified]).toEqual([
      "charge.cardAccountId",
      "journalLine.accountId"
    ]);
    expect(unclassified).toEqual(["accountDefault", "account.parentId"]);
  });

  it("throws when either list is gone, rather than flag every column", () => {
    expect(() => parseReferencePolicy("export const X = [];")).toThrow(
      /REFERENCE_POLICY not found/
    );
    expect(() =>
      parseReferencePolicy("export const REFERENCE_POLICY = [\n];")
    ).toThrow(/UNCLASSIFIED_ACCOUNT_REFERENCES not found/);
  });
});
