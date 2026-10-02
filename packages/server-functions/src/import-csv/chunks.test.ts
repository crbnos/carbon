// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { expect, it } from "vitest";
import { inChunks } from "./chunks";

it("inserts in chunks of 500 and returns every row in input order", async () => {
  const rows = Array.from({ length: 1201 }, (_, i) => i);
  const sizes: number[] = [];
  const returned = await inChunks(rows, async (chunk) => {
    sizes.push(chunk.length);
    return chunk.map((n) => ({ id: n }));
  });
  expect(sizes).toEqual([500, 500, 201]);
  expect(returned.map(({ id }) => id)).toEqual(rows);
});
