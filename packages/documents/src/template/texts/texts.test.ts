// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { makeText, TEXT_CATALOG } from "./index";
import type { TextEntry } from "./types";

const entries = [
  { key: "taxId", kind: "field", default: "Tax ID:" },
  { key: "total", kind: "text", default: "Total ({order.currency})" }
] as const satisfies readonly TextEntry[];

const vars = { "order.currency": "USD" };

describe("makeText", () => {
  it("prints the default when the user changed nothing", () => {
    expect(makeText(entries, undefined, vars)("taxId")).toBe("Tax ID:");
  });

  it("prints the user's text in place of the default", () => {
    const t = makeText(entries, { text: { taxId: "GST No.:" } }, vars);
    expect(t("taxId")).toBe("GST No.:");
  });

  it("prints nothing for a text the user emptied", () => {
    expect(makeText(entries, { text: { taxId: "" } }, vars)("taxId")).toBe("");
  });

  it("fills variables in defaults and in the user's text", () => {
    expect(makeText(entries, undefined, vars)("total")).toBe("Total (USD)");
    const t = makeText(
      entries,
      { text: { taxId: "{order.currency} ID" } },
      vars
    );
    expect(t("taxId")).toBe("USD ID");
  });

  it("hides only the keys the user hid", () => {
    const t = makeText(entries, { hidden: ["taxId"] }, vars);
    expect(t.shows("taxId")).toBe(false);
    expect(t.shows("total")).toBe(true);
  });
});

describe("TEXT_CATALOG", () => {
  // A duplicate key would make two printed texts share one stored value.
  it("has unique keys and a non-empty default in every block", () => {
    for (const [documentType, catalog] of Object.entries(TEXT_CATALOG)) {
      for (const [blockType, blockEntries] of Object.entries(catalog)) {
        const keys = (blockEntries ?? []).map((entry) => entry.key);
        expect(
          new Set(keys).size,
          `${documentType}.${blockType} has a duplicate key`
        ).toBe(keys.length);
        for (const entry of blockEntries ?? []) {
          expect(
            entry.default.length,
            `${documentType}.${blockType}.${entry.key}`
          ).toBeGreaterThan(0);
        }
      }
    }
  });
});
