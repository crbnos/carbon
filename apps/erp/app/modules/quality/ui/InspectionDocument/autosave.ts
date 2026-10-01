// The inspection plan editor saves itself. Rows created in the browser carry
// temp ids until a save returns their persisted ids, and the user can keep
// editing while a save is in flight — so a save response is merged into the
// current rows rather than replacing them.

/** Quiet period after the last edit before the plan is saved. */
export const AUTOSAVE_DELAY_MS = 500;

export function isTempFeatureId(featureId: string) {
  return featureId.startsWith("temp-ftr-");
}

export function isTempBalloonId(balloonId: string | null) {
  return balloonId != null && balloonId.startsWith("temp-bln-");
}

type MergeableRow = {
  featureId: string;
  balloonId: string | null;
  balloonAnchorId: string;
  featureDirty?: boolean;
  geometryDirty?: boolean;
};

type MergeableAnchor = {
  id: string;
  isNew: boolean;
  isDirty: boolean;
};

export function hasUnsavedRows(
  rows: MergeableRow[],
  anchors: MergeableAnchor[]
) {
  return (
    rows.some(
      (r) =>
        isTempFeatureId(r.featureId) ||
        isTempBalloonId(r.balloonId) ||
        r.featureDirty ||
        (r.geometryDirty && r.balloonId != null)
    ) || anchors.some((a) => a.isNew || a.isDirty)
  );
}

/**
 * Merges a save response into the rows the editor holds now.
 *
 * - A row untouched since the save went out (same object) takes the server's
 *   copy.
 * - A row edited meanwhile keeps the edit, re-pointed at the persisted ids
 *   and left dirty, so the next save sends it as an update.
 * - A row the save created but the user deleted while it was in flight is
 *   returned for deletion: the delete handlers skip temp ids.
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
  savedAnchors,
  persistedIds
}: {
  sentRows: R[];
  sentAnchors: A[];
  currentRows: R[];
  currentAnchors: A[];
  savedRows: R[];
  savedAnchors: A[];
  /** temp id → persisted id, including this response's mappings. */
  persistedIds: ReadonlyMap<string, string>;
}) {
  const resolve = (id: string) => persistedIds.get(id) ?? id;

  const currentFeatureIds = new Set(currentRows.map((r) => r.featureId));
  const currentBalloonIds = new Set(currentRows.map((r) => r.balloonId));
  const featureDeleteIds: string[] = [];
  const balloonDeleteIds: string[] = [];
  for (const r of sentRows) {
    if (isTempFeatureId(r.featureId) && !currentFeatureIds.has(r.featureId)) {
      const id = persistedIds.get(r.featureId);
      if (id) featureDeleteIds.push(id);
    } else if (
      r.balloonId != null &&
      isTempBalloonId(r.balloonId) &&
      !currentBalloonIds.has(r.balloonId)
    ) {
      // Deleting a feature cascades to its balloon, so only a balloon whose
      // feature survived needs its own delete.
      const id = persistedIds.get(r.balloonId);
      if (id) balloonDeleteIds.push(id);
    }
  }

  const sentRowSet = new Set(sentRows);
  const savedRowById = new Map(savedRows.map((r) => [r.featureId, r]));
  const rows = currentRows.map((r): R => {
    const featureId = resolve(r.featureId);
    if (sentRowSet.has(r)) return savedRowById.get(featureId) ?? r;
    const balloonId = r.balloonId == null ? null : resolve(r.balloonId);
    if (featureId === r.featureId && balloonId === r.balloonId) return r;
    return {
      ...r,
      featureId,
      balloonId,
      balloonAnchorId: r.balloonAnchorId
        ? resolve(r.balloonAnchorId)
        : r.balloonAnchorId,
      featureDirty: r.featureDirty || featureId !== r.featureId,
      geometryDirty: r.geometryDirty || balloonId !== r.balloonId
    };
  });

  const sentAnchorSet = new Set(sentAnchors);
  const savedAnchorById = new Map(savedAnchors.map((a) => [a.id, a]));
  const anchors = currentAnchors.map((a): A => {
    const id = resolve(a.id);
    if (sentAnchorSet.has(a)) return savedAnchorById.get(id) ?? a;
    return id === a.id ? a : { ...a, id, isNew: false, isDirty: true };
  });

  return { rows, anchors, featureDeleteIds, balloonDeleteIds };
}
