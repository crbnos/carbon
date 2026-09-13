/**
 * Correlating a make method's BOM lines with the copy taken of them.
 *
 * A push must never write into a released (Active) method — Carbon's model is
 * that a live method is superseded by a new Draft version, which is what a
 * change notice's `Version` type does. So when the panel meets an Active
 * method it takes a Draft copy and writes there instead.
 *
 * That copy is where line ownership can be lost. A push only replaces lines a
 * previous push wrote, identified by an `externalIntegrationMapping` row keyed
 * on the line id; the copy has new line ids and no mappings, so every
 * Onshape-owned line would read as manual and the next push would insert a
 * second copy beside each one. The mappings have to be carried across, and the
 * copy carries no back-pointer to say which new line came from which old one.
 *
 * So they are paired on natural key, the same way `diffMethod` correlates a
 * change notice's draft against its base: by component item, and by `order`
 * within a component so an assembly that lists the same part twice keeps both
 * lines distinct. Anything that cannot be paired is left unmapped — an
 * unmapped line is treated as manual, which preserves it. The failure that
 * matters is pairing two lines wrongly, not pairing too few.
 */

export type CorrelatableLine = {
  id: string;
  itemId: string | null;
  order: number | null;
};

/**
 * Map each source line id to the copied line that corresponds to it. Lines
 * with no counterpart are absent from the map rather than guessed at.
 */
export function correlateCopiedLines(
  source: CorrelatableLine[],
  target: CorrelatableLine[]
): Map<string, string> {
  const byItem = new Map<string, CorrelatableLine[]>();
  for (const line of target) {
    if (!line.itemId) continue;
    const list = byItem.get(line.itemId) ?? [];
    list.push(line);
    byItem.set(line.itemId, list);
  }
  // `order` is the only thing separating repeated components, and a copy is
  // not guaranteed to preserve row order, so sort both sides the same way.
  for (const list of byItem.values()) list.sort(byOrderThenId);

  const consumed = new Map<string, number>();
  const paired = new Map<string, string>();
  for (const line of [...source].sort(byOrderThenId)) {
    if (!line.itemId) continue;
    const candidates = byItem.get(line.itemId);
    if (!candidates) continue;
    const taken = consumed.get(line.itemId) ?? 0;
    const match = candidates[taken];
    if (!match) continue; // fewer copies than sources: leave the rest unmapped
    consumed.set(line.itemId, taken + 1);
    paired.set(line.id, match.id);
  }
  return paired;
}

function byOrderThenId(a: CorrelatableLine, b: CorrelatableLine): number {
  const left = a.order ?? Number.MAX_SAFE_INTEGER;
  const right = b.order ?? Number.MAX_SAFE_INTEGER;
  if (left !== right) return left - right;
  return a.id.localeCompare(b.id);
}
