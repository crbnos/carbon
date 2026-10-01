// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) Carbon Manufacturing Systems Corporation and contributors.
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Item } from "~/stores/items";

/**
 * Get the readable ID for an item given its ID
 * @param items - Array of items from useItems hook
 * @param itemId - The item ID to look up
 * @returns The readable ID with revision, or undefined if not found
 */
export function getItemReadableId(
  items: Item[],
  itemId?: string | null
): string | undefined {
  if (!itemId) return undefined;
  const item = items.find((item) => item.id === itemId);
  return item?.readableIdWithRevision;
}

/**
 * Get an item by its ID
 * @param items - Array of items from useItems hook
 * @param itemId - The item ID to look up
 * @returns The item, or undefined if not found
 */
export function getItemById(items: Item[], itemId: string): Item | undefined {
  return items.find((item) => item.id === itemId);
}
