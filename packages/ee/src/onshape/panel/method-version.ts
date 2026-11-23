// SPDX-License-Identifier: LicenseRef-Carbon-Commercial
// Carbon Enterprise file, licensed only under the Carbon Commercial License
// (packages/ee/LICENSE). Not AGPL. Running, modifying, or copying it beyond those terms requires a commercial license.

/**
 * Pairs a Draft copy's lines with the Active method's so push-ownership
 * mappings survive the copy, which has new line ids and no back-pointer.
 * Pairs by component item, then `order`; an unpaired line reads as manual.
 */

export type CorrelatableLine = {
  id: string;
  itemId: string | null;
  order: number | null;
};

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
  // A copy may not keep row order, so both sides sort by `order`, then id.
  for (const list of byItem.values()) list.sort(byOrderThenId);

  const consumed = new Map<string, number>();
  const paired = new Map<string, string>();
  for (const line of [...source].sort(byOrderThenId)) {
    if (!line.itemId) continue;
    const candidates = byItem.get(line.itemId);
    if (!candidates) continue;
    const taken = consumed.get(line.itemId) ?? 0;
    const match = candidates[taken];
    if (!match) continue;
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

/** entityType of the mapping row that marks a Draft the push made. */
export const DRAFT_MARKER_ENTITY_TYPE = "makeMethod";

export type DraftCandidate = {
  id: string;
  version: number | null;
  /** Set when a change notice owns the Draft. */
  changeOrderId: string | null;
};

export type DraftMarker = {
  draftId: string;
  sourceMethodId: string | null;
};

/**
 * Newest Draft the push made from the current Active method that no change
 * notice holds: a person's Draft or a half-built copy has no marker to match.
 */
export function pickReusableDraft(
  drafts: DraftCandidate[],
  markers: DraftMarker[],
  activeMethodId: string
): DraftCandidate | null {
  const madeFromActive = new Set(
    markers
      .filter((marker) => marker.sourceMethodId === activeMethodId)
      .map((marker) => marker.draftId)
  );
  let chosen: DraftCandidate | null = null;
  for (const draft of drafts) {
    if (draft.changeOrderId || !madeFromActive.has(draft.id)) continue;
    if (!chosen || (draft.version ?? 0) > (chosen.version ?? 0)) chosen = draft;
  }
  return chosen;
}

/**
 * Pairs over every source line so an owned line cannot claim a manual line's
 * copy on the same component; returns owned lines only. Zero-quantity lines
 * are skipped because the copy drops them.
 */
export function pairOwnedCopiedLines(
  source: Array<CorrelatableLine & { quantity: number | null }>,
  target: CorrelatableLine[],
  ownedIds: ReadonlySet<string>
): Map<string, string> {
  // Only a real 0: the copy keeps a null quantity (it reads as 1).
  const paired = correlateCopiedLines(
    source.filter((line) => line.quantity !== 0),
    target
  );
  for (const sourceId of paired.keys()) {
    if (!ownedIds.has(sourceId)) paired.delete(sourceId);
  }
  return paired;
}
