// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

/** A cell of a people × days matrix. */
export type MatrixPosition = { rowId: string; date: string };

/** Where a chip sits or lands: a cell, or the side panel beside the grid. */
export type MatrixPlace = MatrixPosition | "outside";

/** One drag's answer: the chip, the place it left, the place it landed. */
export type MatrixMove = { chipId: string; from: MatrixPlace; to: MatrixPlace };

/** What a draggable chip carries (`useDraggable` data). */
export type MatrixDragSource = { chipId: string; from: MatrixPlace };

/** What a drop target carries (`useDroppable` data). */
export type MatrixDropTarget = { to: MatrixPlace; disabled?: boolean };

/** The droppable id of a cell, and of the side panel. */
export const MATRIX_OUTSIDE = "outside";
export function matrixCellId(position: MatrixPosition) {
  return `${position.rowId}:${position.date}`;
}

function samePlace(a: MatrixPlace, b: MatrixPlace) {
  if (a === MATRIX_OUTSIDE || b === MATRIX_OUTSIDE) return a === b;
  return a.rowId === b.rowId && a.date === b.date;
}

/**
 * The move a drop makes, or null when it makes none: dropped on nothing, on
 * a disabled cell (an absent day, a read-only user), or back where it was.
 */
export function resolveMatrixDrop(
  active: MatrixDragSource | null | undefined,
  over: MatrixDropTarget | null | undefined
): MatrixMove | null {
  if (!active || !over) return null;
  if (over.disabled) return null;
  if (samePlace(active.from, over.to)) return null;
  return { chipId: active.chipId, from: active.from, to: over.to };
}
