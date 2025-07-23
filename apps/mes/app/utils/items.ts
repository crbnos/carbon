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
