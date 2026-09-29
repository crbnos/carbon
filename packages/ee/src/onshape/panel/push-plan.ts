import type { OnshapeElementPart } from "../lib/client";
import type { PanelItemRow, PanelMappingRow } from "./status";

/**
 * What a push should do for one part — decided from the same three inputs the
 * status list uses, so the badge a user saw and the action they get can't
 * disagree.
 *
 * - `skip-no-part-number`: unmapped part without an Onshape part number —
 *   Onshape owns identity, so the fix belongs there, not in Carbon.
 */
export type PartPushPlan =
  | { action: "create" }
  | { action: "adopt"; itemId: string }
  | { action: "update"; itemId: string }
  | { action: "unchanged"; itemId: string }
  | { action: "skip-no-part-number" };

export function planPartPush({
  part,
  mapping,
  mappingMicroversionId,
  matchedItem
}: {
  part: OnshapeElementPart;
  mapping: PanelMappingRow | undefined;
  /** metadata.microversionId stored on the mapping at last push, if any. */
  mappingMicroversionId: string | null | undefined;
  matchedItem: PanelItemRow | undefined;
}): PartPushPlan {
  if (mapping) {
    if (
      part.microversionId &&
      mappingMicroversionId &&
      part.microversionId === mappingMicroversionId
    ) {
      return { action: "unchanged", itemId: mapping.entityId };
    }
    return { action: "update", itemId: mapping.entityId };
  }

  if (!part.partNumber) {
    return { action: "skip-no-part-number" };
  }

  if (matchedItem) {
    return { action: "adopt", itemId: matchedItem.id };
  }

  return { action: "create" };
}
