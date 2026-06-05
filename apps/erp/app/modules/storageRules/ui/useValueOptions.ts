import type { ValueOptionsLoader } from "@carbon/utils";
import { useMemo } from "react";
import { useItemPostingGroups } from "~/components/Form/ItemPostingGroup";
import { useLocations } from "~/components/Form/Location";
import { useStorageTypes } from "~/components/Form/StorageTypes";
import { itemTypes } from "~/modules/inventory/inventory.models";
import {
  itemReplenishmentSystems,
  itemTrackingTypes
} from "~/modules/items/items.models";

export type ValueOption = { value: string; label: string };
// Partial: not every loader has a flat option list in the builder UI. The
// `storageUnits` loader exists only for the server-side message resolver
// ({condition[n].name} → bin name); the builder uses the hierarchical
// StorageUnitValuePicker for that field, so no flat options are supplied here.
export type ValueOptionsByLoader = Partial<
  Record<ValueOptionsLoader, ValueOption[]>
>;

const enumOptions = (arr: readonly string[]): ValueOption[] =>
  arr.map((v) => ({ value: v, label: v }));

// Module-level constants — stable refs, never re-allocated.
const ITEM_TYPES_OPTIONS = enumOptions(itemTypes);
const ITEM_TRACKING_TYPES_OPTIONS = enumOptions(itemTrackingTypes);
const REPLENISHMENT_SYSTEMS_OPTIONS = enumOptions(itemReplenishmentSystems);

export function useValueOptions(): ValueOptionsByLoader {
  const locations = useLocations();
  const storageTypes = useStorageTypes();
  const itemPostingGroups = useItemPostingGroups();

  return useMemo<ValueOptionsByLoader>(
    () => ({
      locations,
      storageTypes,
      itemPostingGroups,
      itemTypes: ITEM_TYPES_OPTIONS,
      itemTrackingTypes: ITEM_TRACKING_TYPES_OPTIONS,
      replenishmentSystems: REPLENISHMENT_SYSTEMS_OPTIONS
    }),
    [locations, storageTypes, itemPostingGroups]
  );
}
