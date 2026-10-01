import { nanoid } from "nanoid";

// The inspection plan editor saves itself. It mints the ids of the
// characteristics and balloons it creates, so a row keeps one id from the
// moment it is drawn; the user can keep editing while a save is in flight, and
// the save's response is merged into the current rows rather than replacing
// them.

/** Quiet period after the last edit before the plan is saved. */
export const AUTOSAVE_DELAY_MS = 500;

export const newFeatureId = () => `ift_${nanoid()}`;
export const newBalloonId = () => `bbn_${nanoid()}`;

type MergeableRow = {
  featureId: string;
  balloonId: string | null;
  featureDirty?: boolean;
  geometryDirty?: boolean;
};

type MergeableAnchor = {
  id: string;
  isNew: boolean;
  isDirty: boolean;
};

/** `isUnsaved` is true for an id the server has not created yet. */
export function hasUnsavedRows(
  rows: MergeableRow[],
  anchors: MergeableAnchor[],
  isUnsaved: (id: string) => boolean
) {
  return (
    rows.some(
      (r) =>
        isUnsaved(r.featureId) ||
        (r.balloonId != null && isUnsaved(r.balloonId)) ||
        r.featureDirty ||
        (r.geometryDirty && r.balloonId != null)
    ) || anchors.some((a) => a.isNew || a.isDirty)
  );
}

/**
 * Merges a save response into the rows the editor holds now.
 *
 * - A row untouched since the save went out (same object) takes the server's
 *   copy, which is clean.
 * - A row edited meanwhile is kept as it is: every edit marks its row dirty,
 *   so the next save sends it.
 * - An anchor the save created but the user moved meanwhile is no longer new,
 *   only dirty — the next save updates it rather than creating it twice.
 *
 * The current order is kept, so a row never moves under the cursor.
 */
export function mergeSaveResponse<
  R extends MergeableRow,
  A extends MergeableAnchor
>({
  sentRows,
  sentAnchors,
  currentRows,
  currentAnchors,
  savedRows,
  savedAnchors
}: {
  sentRows: R[];
  sentAnchors: A[];
  currentRows: R[];
  currentAnchors: A[];
  savedRows: R[];
  savedAnchors: A[];
}) {
  const sentRowSet = new Set(sentRows);
  const savedRowById = new Map(savedRows.map((r) => [r.featureId, r]));
  const rows = currentRows.map((r) =>
    sentRowSet.has(r) ? (savedRowById.get(r.featureId) ?? r) : r
  );

  const sentAnchorSet = new Set(sentAnchors);
  const createdAnchorIds = new Set(
    sentAnchors.filter((a) => a.isNew).map((a) => a.id)
  );
  const savedAnchorById = new Map(savedAnchors.map((a) => [a.id, a]));
  const anchors = currentAnchors.map((a): A => {
    if (sentAnchorSet.has(a)) return savedAnchorById.get(a.id) ?? a;
    if (createdAnchorIds.has(a.id))
      return { ...a, isNew: false, isDirty: true };
    return a;
  });

  return { rows, anchors };
}
