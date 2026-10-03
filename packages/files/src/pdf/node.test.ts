// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderPdfPageAsPng } from "./node";

const fixture = () => readFile(join(__dirname, "__fixtures__", "sample.pdf"));

/** PNG magic number, so "is this really an image" is not taken on trust. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Width and height out of the IHDR chunk, which is always the first one. */
function pngSize(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe("renderPdfPageAsPng", () => {
  it("renders a page as a real PNG", async () => {
    const png = await renderPdfPageAsPng(await fixture(), 1);
    expect([...png.slice(0, 8)]).toEqual(PNG_SIGNATURE);
    const { width, height } = pngSize(png);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  it("scales the output, which is the only thing scale may change", async () => {
    // Balloon coordinates are normalized 0–1, so scale buys an inspector
    // detail to pinch into and must never move where a balloon lands.
    const [one, three] = await Promise.all([
      renderPdfPageAsPng(await fixture(), 1, { scale: 1 }),
      renderPdfPageAsPng(await fixture(), 1, { scale: 3 })
    ]);
    const small = pngSize(one);
    const large = pngSize(three);
    expect(large.width).toBe(small.width * 3);
    expect(large.height).toBe(small.height * 3);
    // Same page, same aspect ratio — a drawing rendered taller than it is wide
    // would put every balloon in the wrong place.
    expect(large.width / large.height).toBeCloseTo(
      small.width / small.height,
      5
    );
  });

  it("renders a second page differently from the first", async () => {
    // The fixture has two pages. Identical bytes would mean the page number is
    // being ignored, and every page of a drawing would show page one.
    const [first, second] = await Promise.all([
      renderPdfPageAsPng(await fixture(), 1),
      renderPdfPageAsPng(await fixture(), 2)
    ]);
    expect(Buffer.compare(Buffer.from(first), Buffer.from(second))).not.toBe(0);
  });

  it("rejects a page the document does not have", async () => {
    await expect(renderPdfPageAsPng(await fixture(), 99)).rejects.toThrow();
  });
});
