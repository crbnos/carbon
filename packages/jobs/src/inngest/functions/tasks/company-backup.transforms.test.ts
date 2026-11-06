// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { rewriteDocumentEditRowKeys } from "./company-backup.transforms";

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
