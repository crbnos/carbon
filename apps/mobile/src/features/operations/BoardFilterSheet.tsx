// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { OperationsScreen, WorkCenterColumn } from "@carbon/mes-core";
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
  toggleFilter,
  UNASSIGNED
} from "./boardFilters";
import { useBoardPeople } from "./useBoardPeople";

/**
 * Web's board filter popover, as a sheet: work centre, process, tag and
 * assignee, the same four and in the same order.
 *
 * Every section is skipped when it has no options. A plant that tags nothing
 * should not be shown an empty Tag heading, and a server too old to send
 * `processes` simply has no Process section rather than a broken one.
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
    processes: OperationsScreen["processes"];
    availableTags: string[];
    /** Whether any card on the board has no assignee. */
    hasUnassigned: boolean;
    filters: BoardFilters;
    onChange: (filters: BoardFilters) => void;
  }
>(function BoardFilterSheet(
  { columns, processes, availableTags, hasUnassigned, filters, onChange },
  ref
) {
  const { t } = useLingui();
  const count = activeFilterCount(filters);
  // The roster is only needed to NAME an assignee, so it is fetched with the
  // sheet rather than with the board.
  const people = useBoardPeople(true);

  // `id` and `name` are both nullable on the wire; a process missing either
  // cannot be offered as a choice, so it is dropped rather than rendered as a
  // blank row. Web filters the same way.
  const processOptions = (processes ?? []).flatMap((process) =>
    process.id && process.name ? [{ id: process.id, name: process.name }] : []
  );

  const peopleOptions = people.data ?? [];

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

        {processOptions.length ? (
          <View className="gap-1">
            <Muted className="text-sm font-semibold">{t`Process`}</Muted>
            {processOptions.map((process) => (
              <FilterRow
                key={process.id}
                label={process.name}
                selected={filters.processIds.includes(process.id)}
                onPress={() =>
                  onChange(toggleFilter(filters, "processIds", process.id))
                }
              />
            ))}
          </View>
        ) : null}

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

        {peopleOptions.length || hasUnassigned ? (
          <View className="gap-1">
            <Muted className="text-sm font-semibold">{t`Assignee`}</Muted>
            {hasUnassigned ? (
              <FilterRow
                label={t`Unassigned`}
                selected={filters.assignees.includes(UNASSIGNED)}
                onPress={() =>
                  onChange(toggleFilter(filters, "assignees", UNASSIGNED))
                }
              />
            ) : null}
            {peopleOptions.map((person) => (
              <FilterRow
                key={person.id}
                label={person.name}
                selected={filters.assignees.includes(person.id)}
                onPress={() =>
                  onChange(toggleFilter(filters, "assignees", person.id))
                }
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
