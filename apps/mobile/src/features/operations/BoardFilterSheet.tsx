// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { WorkCenterColumn } from "@carbon/mes-core";
import { useLingui } from "@lingui/react/macro";
import { Check } from "lucide-react-native";
import { forwardRef } from "react";
import { Pressable, Text, View } from "react-native";
import { Sheet, type SheetHandle } from "~/components/BottomSheet";
import { Button, Muted } from "~/components/ui";
import { useThemeColors } from "~/components/useThemeColor";
import {
  activeFilterCount,
  type BoardFilters,
  EMPTY_FILTERS,
  toggleFilter
} from "./boardFilters";

/**
 * Web's board filter popover, as a sheet.
 *
 * Work centre and tag only — the two whose options arrive with their display
 * names. Process and assignee come over the wire as bare ids, and a picker of
 * uuids is worse than no picker.
 *
 * Rows are 56pt with a tick rather than a checkbox: a tick is legible at a
 * glance across a machine, and the whole row is the target.
 */

function FilterRow({
  label,
  selected,
  onPress
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      className="min-h-[56px] flex-row items-center justify-between gap-3 rounded-lg px-2 active:bg-muted"
    >
      <Text
        className={`flex-1 text-base ${
          selected ? "font-semibold text-foreground" : "text-foreground"
        }`}
        numberOfLines={1}
      >
        {label}
      </Text>
      {selected ? <Check size={20} color={colors.foreground} /> : null}
    </Pressable>
  );
}

export const BoardFilterSheet = forwardRef<
  SheetHandle,
  {
    columns: WorkCenterColumn[];
    availableTags: string[];
    filters: BoardFilters;
    onChange: (filters: BoardFilters) => void;
  }
>(function BoardFilterSheet(
  { columns, availableTags, filters, onChange },
  ref
) {
  const { t } = useLingui();
  const count = activeFilterCount(filters);

  return (
    <Sheet ref={ref} title={t`Filter`}>
      <View className="gap-4 px-2 pt-2">
        <View className="gap-1">
          <Muted className="text-sm font-semibold">{t`Work center`}</Muted>
          {columns.map((column) => (
            <FilterRow
              key={column.id}
              label={column.title}
              selected={filters.workCenterIds.includes(column.id)}
              onPress={() =>
                onChange(toggleFilter(filters, "workCenterIds", column.id))
              }
            />
          ))}
        </View>

        {availableTags.length ? (
          <View className="gap-1">
            <Muted className="text-sm font-semibold">{t`Tag`}</Muted>
            {availableTags.map((tag) => (
              <FilterRow
                key={tag}
                label={tag}
                selected={filters.tags.includes(tag)}
                onPress={() => onChange(toggleFilter(filters, "tags", tag))}
              />
            ))}
          </View>
        ) : null}

        <Button
          variant="secondary"
          disabled={count === 0}
          onPress={() => onChange(EMPTY_FILTERS)}
        >
          {count === 0 ? t`No filters` : t`Clear ${count} filter(s)`}
        </Button>
      </View>
    </Sheet>
  );
});
