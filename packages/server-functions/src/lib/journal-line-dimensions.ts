// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";

/** A journal line's dimension values, by entity type: the shape a pure
 *  posting builder returns and the legacy backfill writes as is. */
export type JournalLineDimensionValues = Partial<
  Record<Database["public"]["Enums"]["dimensionEntityType"], string | null>
>;

/**
 * The `journalLineDimension` rows of inserted lines: `journalLineIds[i]` is
 * the id of `lines[i]`. A value whose entity type has no active dimension
 * (`dimensionIdByEntity`) writes none. Rows follow each line's key order.
 */
export function journalLineDimensionRows({
  journalLineIds,
  lines,
  dimensionIdByEntity,
  companyId
}: {
  journalLineIds: string[];
  lines: { dimensions: JournalLineDimensionValues }[];
  dimensionIdByEntity: ReadonlyMap<string, string>;
  companyId: string;
}) {
  return journalLineIds.flatMap((journalLineId, index) =>
    Object.entries(lines[index]?.dimensions ?? {}).flatMap(
      ([entityType, valueId]) => {
        const dimensionId = dimensionIdByEntity.get(entityType);
        return dimensionId && valueId
          ? [{ journalLineId, dimensionId, valueId, companyId }]
          : [];
      }
    )
  );
}
