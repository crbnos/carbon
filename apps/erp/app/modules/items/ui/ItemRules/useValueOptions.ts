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
export type ValueOptionsByLoader = Record<ValueOptionsLoader, ValueOption[]>;

const enumOptions = (arr: readonly string[]): ValueOption[] =>
  arr.map((v) => ({ value: v, label: v }));

// Module-level constants — stable refs, never re-allocated.
const ITEM_TYPES_OPTIONS = enumOptions(itemTypes);
const ITEM_TRACKING_TYPES_OPTIONS = enumOptions(itemTrackingTypes);
const REPLENISHMENT_SYSTEMS_OPTIONS = enumOptions(itemReplenishmentSystems);

/**
 * Aggregates every {@link ValueOptionsLoader} into a single map for the rule
 * builder's value picker. DB-backed loaders share the existing `useFetcher`
 * hooks already used by the form-component pickers — they fetch once on mount
 * and re-use the cached payload across rows. Static enum loaders are mapped
 * from module-level constants.
 *
 * Returned object reference is memoised on the underlying option arrays so
 * memoised consumers (`ConditionRow`) skip re-renders when nothing changed.
 */
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
