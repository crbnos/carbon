// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/**
 * Splits `items` into order-preserving packs that each serialize to at most
 * `maxBytes` and hold at most `maxItems`. An item larger than the budget
 * travels alone rather than being dropped.
 */
export function packBySize<T>(
  items: T[],
  maxBytes: number,
  maxItems = Number.POSITIVE_INFINITY
): T[][] {
  const packs: T[][] = [];
  let current: T[] = [];
  let bytes = 0;

  for (const item of items) {
    const size = Buffer.byteLength(JSON.stringify(item));
    if (
      current.length > 0 &&
      (bytes + size > maxBytes || current.length >= maxItems)
    ) {
      packs.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += size;
  }

  if (current.length > 0) packs.push(current);
  return packs;
}
