import type { MultiSelectProps } from "@carbon/form";
import { MultiSelect } from "@carbon/form";
import { useMemo } from "react";
import { useStorageUnitsTree } from "./StorageUnit";

type StorageUnitsSelectProps = Omit<MultiSelectProps, "options"> & {
  locationId?: string | null;
};

/**
 * Multi-select over every storage unit in a location — parents included, unlike
 * the single-select `StorageUnit` picker, which offers leaves only. Selecting a
 * parent is meaningful here because callers expand the selection to its
 * descendants (`expandStorageUnitIdsWithDescendants`), so scoping to a rack
 * covers the bins inside it.
 */
const StorageUnits = ({ locationId, ...props }: StorageUnitsSelectProps) => {
  const options = useStorageUnitTreeOptions(locationId);

  return (
    <MultiSelect
      options={options}
      {...props}
      label={props?.label ?? "Storage Units"}
    />
  );
};

/**
 * Options for every node in a location's storage-unit tree, ordered
 * root-first so children read beneath their parent. `helper` carries the
 * ancestor path to disambiguate same-named bins under different parents.
 */
export function useStorageUnitTreeOptions(locationId?: string | null) {
  const rows = useStorageUnitsTree(locationId);

  return useMemo(() => {
    const nameById = new Map(rows.map((r) => [r.id, r.name]));

    const pathOf = (row: (typeof rows)[number]) =>
      (row.ancestorPath ?? [])
        .slice(0, -1)
        .map((id) => nameById.get(id))
        .filter(Boolean)
        .join(" / ");

    return rows
      .map((r) => ({
        value: r.id,
        label: r.name,
        helper: pathOf(r) || undefined,
        sortKey: [...(r.ancestorPath ?? [])]
          .map((id) => nameById.get(id) ?? id)
          .join("/")
      }))
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
      .map(({ sortKey: _sortKey, ...option }) => option);
  }, [rows]);
}

StorageUnits.displayName = "StorageUnits";

export default StorageUnits;
