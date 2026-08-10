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
  // Indexed loop — `.find` allocates a closure per call. Hot path: list
  // rendering looks up readable ids per row.
  const len = items.length;
  for (let i = 0; i < len; i++) {
    const item = items[i]!;
    if (item.id === itemId) return item.readableIdWithRevision;
  }
  return undefined;
}

/**
 * Get an item by its ID
 * @param items - Array of items from useItems hook
 * @param itemId - The item ID to look up
 * @returns The item, or undefined if not found
 */
export function getItemById<T extends Item>(
  items: T[],
  itemId: string
): T | undefined {
  const len = items.length;
  for (let i = 0; i < len; i++) {
    const item = items[i]!;
    if (item.id === itemId) return item;
  }
  return undefined;
}

// Build a separator-joined string from a fixed-arity record without
// allocating an intermediate `[…].filter().join()` array — saves two array
// allocations and a closure per call. Falsy parts (undefined, "") are
// dropped to match the prior `.filter((p) => !!p)` behaviour.
function joinTruthy(parts: (string | undefined)[], sep: string): string {
  let out = "";
  const len = parts.length;
  for (let i = 0; i < len; i++) {
    const part = parts[i];
    if (!part) continue;
    out = out.length === 0 ? part : out + sep + part;
  }
  return out;
}

export function getMaterialDescription(material: {
  materialType?: string;
  substance?: string;
  grade?: string;
  shape?: string;
  dimensions?: string;
  finish?: string;
}) {
  return joinTruthy(
    [
      material.grade,
      material.substance,
      material.materialType,
      material.shape,
      material.dimensions,
      material.finish
    ],
    " "
  );
}

export function getMaterialId(material: {
  materialTypeCode?: string;
  substanceCode?: string;
  grade?: string;
  shapeCode?: string;
  dimensions?: string;
  finish?: string;
}) {
  return joinTruthy(
    [
      material.grade,
      material.substanceCode,
      material.materialTypeCode,
      material.shapeCode,
      material.dimensions,
      material.finish
    ],
    "-"
  );
}
