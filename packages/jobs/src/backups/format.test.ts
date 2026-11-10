// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readTableRows, tableWriter } from "./format";

describe("tableWriter / readTableRows", () => {
  it("round-trips text holding the Unicode line and paragraph separators", async () => {
    // JSON.stringify leaves U+2028/U+2029 unescaped, and Node 24's readline
    // ends a line at them, which split a row mid-string on restore.
    const rows = [
      { id: "a", notes: "pasted\u2028from a PDF\u2029and Word" },
      { id: "b", notes: "carriage\rreturn and\nnewline" }
    ];
    const writer = tableWriter();
    await writer.write(rows);
    const bytes = await writer.finish();
    const text = gunzipSync(bytes).toString("utf8");
    expect(text.split("\n")).toHaveLength(rows.length + 1);
    expect(text).not.toMatch(/[\u2028\u2029]/);
    const read = [];
    for await (const batch of readTableRows([bytes])) read.push(...batch);
    expect(read).toEqual(rows);
  });

  it("reads a table back in batches, across the writes that made it", async () => {
    const writer = tableWriter();
    for (let w = 0; w < 3; w++) {
      await writer.write(
        Array.from({ length: 4 }, (_, i) => ({ id: `${w}-${i}` }))
      );
    }
    const bytes = await writer.finish();
    // Byte by byte, so no line ever arrives in one chunk.
    const chunks = [...bytes].map((b) => new Uint8Array([b]));
    const sizes: number[] = [];
    const ids: unknown[] = [];
    for await (const batch of readTableRows(chunks, 5)) {
      sizes.push(batch.length);
      ids.push(...batch.map((r) => r.id));
    }
    expect(sizes).toEqual([5, 5, 2]);
    expect(ids).toHaveLength(12);
    expect(ids[11]).toBe("2-3");
  });
});
