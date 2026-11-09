// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { deserializeTable, serializeTable } from "./company-backup";

describe("serializeTable / deserializeTable", () => {
  it("round-trips text holding the Unicode line and paragraph separators", async () => {
    // JSON.stringify leaves U+2028/U+2029 unescaped, and Node 24's readline
    // ends a line at them, which split a row mid-string on restore.
    const rows = [
      { id: "a", notes: "pasted\u2028from a PDF\u2029and Word" },
      { id: "b", notes: "carriage\rreturn and\nnewline" }
    ];
    const bytes = await serializeTable(rows);
    const text = gunzipSync(bytes).toString("utf8");
    expect(text.split("\n")).toHaveLength(rows.length + 1);
    expect(text).not.toMatch(/[\u2028\u2029]/);
    const copy = new ArrayBuffer(bytes.length);
    new Uint8Array(copy).set(bytes);
    expect(await deserializeTable(copy)).toEqual(rows);
  });
});
