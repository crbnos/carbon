// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { describe, expect, it } from "vitest";
import { packBySize } from "./pack";

const row = (id: number, bytes: number) => ({ id, pad: "x".repeat(bytes) });

describe("packBySize", () => {
  it("keeps order and fills each pack up to the byte budget", () => {
    const items = [row(1, 400), row(2, 400), row(3, 400), row(4, 400)];
    const packs = packBySize(items, 1000);
    expect(packs.map((p) => p.map((i) => i.id))).toEqual([
      [1, 2],
      [3, 4]
    ]);
  });

  it("sends an item larger than the budget on its own", () => {
    const packs = packBySize([row(1, 50), row(2, 5000), row(3, 50)], 1000);
    expect(packs.map((p) => p.map((i) => i.id))).toEqual([[1], [2], [3]]);
  });

  it("caps the item count per pack", () => {
    const items = [1, 2, 3, 4, 5].map((id) => row(id, 1));
    expect(packBySize(items, 1_000_000, 2).map((p) => p.length)).toEqual([
      2, 2, 1
    ]);
  });

  it("returns no packs for no items", () => {
    expect(packBySize([], 1000)).toEqual([]);
  });
});
