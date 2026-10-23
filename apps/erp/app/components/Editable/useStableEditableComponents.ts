// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useEffect, useMemo, useRef } from "react";
import type { EditableTableCellComponent } from "./types";

/**
 * Builds a grid's editors once and keeps them for the life of the grid.
 *
 * Each `EditableNumber` / `EditableText` / `EditableDate` / `EditableList`
 * call returns a NEW component. Rebuilding them (because a save callback
 * changed when the previous save revalidated) remounts the open editor and
 * drops the value the user is typing — see `OpenOrdersGrid` in
 * `modules/production/ui/Planning/PlanningOrderGrids.tsx`. So `build` runs
 * once, and the editors read the latest `callbacks` through `latest.current`.
 *
 * ```tsx
 * const editableComponents = useStableEditableComponents(
 *   (latest) => ({
 *     hours: EditableNumber<Row>((key, value, row) =>
 *       latest.current.onCellEdit(key, value, row))
 *   }),
 *   { onCellEdit }
 * );
 * ```
 */
export function useStableEditableComponents<
  C,
  R extends Record<string, EditableTableCellComponent<any>>
>(build: (latest: { current: C }) => R, callbacks: C): R {
  const latest = useRef(callbacks);
  useEffect(() => {
    latest.current = callbacks;
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: built once on purpose; the editors read `latest`
  return useMemo(() => build(latest), []);
}
