// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import {
  rewriteDocumentEditRowKeys,
  rewriteTrackedEntityReceiptRefs
} from "./company-backup.transforms";

describe("rewriteDocumentEditRowKeys", () => {
  const rewrite = new Map([["old", "new"]]);
  const settings = {
    text: { title: "Order" },
    valueEdits: {
      document: { "order.date": "Soon" },
      rows: {
        "line:old": { "line.details": "One" },
        "line:kept": { "line.details": "Two" }
      }
    }
  };
  const rewritten = {
    ...settings,
    valueEdits: {
      ...settings.valueEdits,
      rows: {
        "line:new": { "line.details": "One" },
        "line:kept": { "line.details": "Two" }
      }
    }
  };

  it("follows the restore's ids in a row's key", () => {
    expect(rewriteDocumentEditRowKeys(settings, rewrite)).toEqual(rewritten);
  });

  it("keeps the shape it was given: a backup holds JSON as text", () => {
    expect(
      JSON.parse(
        rewriteDocumentEditRowKeys(JSON.stringify(settings), rewrite) as string
      )
    ).toEqual(rewritten);
  });

  it("leaves settings with no changed row values alone", () => {
    const plain = { text: { title: "Order" } };
    expect(rewriteDocumentEditRowKeys(plain, rewrite)).toBe(plain);
    expect(rewriteDocumentEditRowKeys(null, rewrite)).toBeNull();
  });
});

describe("rewriteTrackedEntityReceiptRefs", () => {
  const rewrite = new Map([
    ["old-receipt", "new-receipt"],
    ["old-line", "new-line"]
  ]);

  it("remaps the receipt and its line, and leaves other attributes", () => {
    expect(
      rewriteTrackedEntityReceiptRefs(
        { Receipt: "old-receipt", "Receipt Line": "old-line", Job: "old-job" },
        rewrite
      )
    ).toEqual({
      Receipt: "new-receipt",
      "Receipt Line": "new-line",
      Job: "old-job"
    });
  });

  it("keeps a string a string, and returns no refs as they came", () => {
    expect(
      JSON.parse(
        rewriteTrackedEntityReceiptRefs(
          JSON.stringify({ "Receipt Line": "old-line" }),
          rewrite
        ) as string
      )
    ).toEqual({ "Receipt Line": "new-line" });
    const none = { Job: "old-job" };
    expect(rewriteTrackedEntityReceiptRefs(none, rewrite)).toBe(none);
  });
});
