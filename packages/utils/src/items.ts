type Item = {
  id: string;
  readableIdWithRevision: string;
};

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

export function getMaterialDescription(material: {
  materialType?: string;
  substance?: string;
  grade?: string;
  shape?: string;
  dimensions?: string;
  finish?: string;
}) {
  return [
    material.grade,
    material.substance,
    material.materialType,
    material.shape,
    material.dimensions,
    material.finish,
  ]
    .filter((p) => !!p)
    .join(" ");
}

export function getMaterialId(material: {
  materialTypeCode?: string;
  substanceCode?: string;
  grade?: string;
  shapeCode?: string;
  dimensions?: string;
  finish?: string;
}) {
  return [
    material.grade,
    material.substanceCode,
    material.materialTypeCode,
    material.shapeCode,
    material.dimensions,
    material.finish,
  ]
    .filter((p) => !!p)
    .join("-");
}
