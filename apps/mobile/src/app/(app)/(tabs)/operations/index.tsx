// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { OperationCard as OperationCardData } from "@carbon/mes-core";
import { Trans, useLingui } from "@lingui/react/macro";
import { router, useFocusEffect } from "expo-router";
import { Factory, SlidersHorizontal, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  useWindowDimensions,
  View
} from "react-native";
import type { SheetHandle } from "~/components/BottomSheet";
import {
  Button,
  EmptyState,
  ErrorNote,
  Heading,
  Muted,
  Screen,
  Skeleton
} from "~/components/ui";
import { useLayout } from "~/components/useLayout";
import { usePullToRefresh } from "~/components/usePullToRefresh";
import { useThemeColors } from "~/components/useThemeColor";
import { WorkingAt } from "~/features/context/WorkingAt";
import { BoardFilterSheet } from "~/features/operations/BoardFilterSheet";
import {
  activeFilterCount,
  type BoardFilters,
  EMPTY_FILTERS,
  filterColumns,
  filterOperations
} from "~/features/operations/boardFilters";
import { OperationCard } from "~/features/operations/OperationCard";
import { QueueSwitcher } from "~/features/operations/QueueSwitcher";
import {
  loadStationFilter,
  saveStationFilter
} from "~/features/operations/stationFilter";
import { useOperationsQuery } from "~/features/operations/useOperationsQuery";
import { useAuth } from "~/lib/auth/AuthProvider";

/**
 * The operations board — a column per work centre, as web MES's Schedule board
 * is (`apps/mes/app/routes/x+/operations.tsx` + `components/Kanban`).
 *
 * Columns rather than a filtered flat list because that is the screen an
 * operator already knows: the work centres ARE the filter, the queue under each
 * is its own, and a blocked centre is visible without opening anything.
 *
 * It scrolls horizontally. A phone shows one column with a peek of the next, a
 * tablet shows two or three — the same board, as much of it as the glass
 * allows.
 */

/** Web's `PulsingDot`: green when the centre is running, muted when idle. */
function ColumnDot({ active }: { active: boolean }) {
  return (
    <View
      className={`mt-1.5 size-2.5 rounded-full ${
        active ? "bg-emerald-500" : "bg-muted-foreground/40"
      }`}
    />
  );
}

function Column({
  title,
  active,
  isBlocked,
  operations,
  width,
  refreshing,
  onRefresh
}: {
  title: string;
  active: boolean;
  isBlocked: boolean;
  operations: OperationCardData[];
  width: number;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const { t } = useLingui();

  return (
    <View className="h-full border-r border-border" style={{ width }}>
      {/*
        The column header, from `Kanban/components/ColumnCard.tsx`: the dot and
        the title, with the count beneath. A blocked centre turns the whole
        header destructive — the web does the same, because it is the one state
        an operator must see before walking to the machine.
      */}
      <View
        className={`flex-row items-start gap-2 border-b border-border px-4 py-3 ${
          isBlocked ? "bg-destructive" : "bg-card"
        }`}
      >
        {isBlocked ? null : <ColumnDot active={active} />}
        <View className="flex-1">
          <Text
            className={`font-semibold ${
              isBlocked ? "text-destructive-foreground" : "text-foreground"
            }`}
            numberOfLines={1}
          >
            {title}
          </Text>
          <Text
            className={`text-xs ${
              isBlocked
                ? "text-destructive-foreground"
                : "text-muted-foreground"
            }`}
          >
            {isBlocked
              ? t`Blocked for maintenance`
              : operations.length === 0
                ? t`No scheduled work`
                : t`${operations.length} operation(s)`}
          </Text>
        </View>
      </View>

      <FlatList
        data={operations}
        keyExtractor={(item) => item.id}
        ItemSeparatorComponent={() => <View className="h-3" />}
        contentContainerClassName="p-3 pb-8"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <Muted className="px-1 py-6 text-center text-sm">
            {t`Nothing queued here.`}
          </Muted>
        }
        renderItem={({ item }) => (
          <OperationCard
            operation={item}
            onPress={() =>
              router.push(`/(app)/(tabs)/operations/${item.id}` as never)
            }
          />
        )}
      />
    </View>
  );
}

export default function Operations() {
  const { t } = useLingui();
  const { me, locationId } = useAuth();
  const { isTablet } = useLayout();
  const { width: screenWidth } = useWindowDimensions();
  const colors = useThemeColors();
  // The board opens on the WHOLE floor; the operator's manning-board station
  // is something they ask for. See `stationFilter.ts` for why this is the
  // opposite of web.
  const { instanceId, companyId: scopeCompanyId } = useAuth();
  const scope = useMemo(
    () => ({
      instanceId: instanceId ?? "unknown",
      companyId: scopeCompanyId ?? ""
    }),
    [instanceId, scopeCompanyId]
  );
  const [onlyMyStation, setOnlyMyStation] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void loadStationFilter(scope).then((on) => {
      if (!cancelled) setOnlyMyStation(on);
    });
    return () => {
      cancelled = true;
    };
  }, [scope]);
  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS);
  const filterSheet = useRef<SheetHandle>(null);
  // The server applies the station default unless told otherwise, so asking
  // for the whole floor is the DEFAULT request this screen makes.
  const query = useOperationsQuery([], !onlyMyStation);
  const { refreshing, onRefresh } = usePullToRefresh(query.refetch);

  // The floor moves while the operator is on another screen.
  useFocusEffect(
    useCallback(() => {
      void query.refetch();
    }, [query.refetch])
  );

  // `myStation` rather than `peopleStation`: the latter is only set when the
  // server APPLIED the station, and this board asks for the whole floor, so it
  // would always be null here and the chip would never appear.
  const stationName = query.data?.myStation?.name || null;

  const locationName =
    me?.locations.find((l) => l.id === locationId)?.name ?? "";
  // The other locations of THIS company that do have work centers, named with
  // their counts — what an empty board points at.
  const elsewhere = useMemo(() => {
    const counts = new Map<string, number>();
    for (const workCenter of me?.workCenters ?? []) {
      counts.set(
        workCenter.locationId,
        (counts.get(workCenter.locationId) ?? 0) + 1
      );
    }
    return (me?.locations ?? [])
      .filter((l) => l.id !== locationId && (counts.get(l.id) ?? 0) > 0)
      .map((l) => `${l.name} (${counts.get(l.id)})`);
  }, [me, locationId]);
  const allColumns = query.data?.columns ?? [];
  const columns = useMemo(
    () => filterColumns(allColumns, filters),
    [allColumns, filters]
  );
  const items = useMemo(
    () => filterOperations(query.data?.items ?? [], filters),
    [query.data?.items, filters]
  );
  const filterCount = activeFilterCount(filters);

  const byColumn = useMemo(() => {
    const map = new Map<string, OperationCardData[]>();
    for (const item of items) {
      const key = item.columnId ?? "";
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    return map;
  }, [items]);

  // A phone shows one column and a peek of the next, so it is obvious the
  // board scrolls sideways; a tablet shows whole columns at a readable width.
  const columnWidth = isTablet
    ? 340
    : Math.min(Math.round(screenWidth * 0.86), 380);

  return (
    <Screen className="gap-3 px-0 py-4">
      <View className="px-4">
        <Heading>
          <Trans>Schedule</Trans>
        </Heading>
        <WorkingAt />
      </View>

      {/*
        The board is one of web MES's four OPERATIONS items; the other three are
        this operator's own queues. The switcher is how they are reached without
        a sixth bottom tab — see `QueueSwitcher`.
      */}
      <QueueSwitcher current="board" />

      <View className="flex-row items-center gap-2 px-4">
        <Pressable
          onPress={() => filterSheet.current?.open()}
          accessibilityRole="button"
          accessibilityLabel={t`Filter the board`}
          className="min-h-[44px] flex-row items-center gap-2 rounded-lg border border-border bg-card px-3 active:opacity-70"
        >
          <SlidersHorizontal size={16} color={colors.mutedForeground} />
          <Text className="text-sm text-foreground">
            {filterCount === 0 ? t`Filter` : t`Filter (${filterCount})`}
          </Text>
        </Pressable>

        {/* A TOGGLE, not a dismissal: off is the whole floor and on is just
            this operator's station. It reads as a filter chip because that is
            what it is — the previous version looked like a notice with a
            close button, so an operator had no reason to think tapping it
            would bring six work centres back. Only shown when the operator
            actually has a station today. */}
        {stationName ? (
          <Pressable
            onPress={() => {
              const next = !onlyMyStation;
              setOnlyMyStation(next);
              void saveStationFilter(scope, next);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: onlyMyStation }}
            accessibilityLabel={
              onlyMyStation
                ? t`Showing only ${stationName}. Show every work center`
                : t`Show only my station, ${stationName}`
            }
            className={`min-h-[44px] flex-1 flex-row items-center gap-2 rounded-lg border px-3 active:opacity-70 ${
              onlyMyStation
                ? "border-primary bg-primary/10"
                : "border-border bg-card"
            }`}
          >
            <Factory
              size={16}
              color={onlyMyStation ? colors.foreground : colors.mutedForeground}
            />
            <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
              {stationName}
            </Text>
            {onlyMyStation ? (
              <X size={16} color={colors.mutedForeground} />
            ) : null}
          </Pressable>
        ) : null}
      </View>

      {query.isError ? (
        <View className="px-4">
          <ErrorNote>
            {query.error instanceof Error
              ? query.error.message
              : t`Could not load operations`}
          </ErrorNote>
        </View>
      ) : null}

      {query.isPending ? (
        // A skeleton, never an empty screen: an operator must be able to tell
        // "still loading" from "nothing to do".
        <View className="gap-3 px-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </View>
      ) : columns.length === 0 ? (
        allColumns.length > 0 ? (
          // The location HAS work centers; the filter is hiding all of them.
          // Saying "no work centers" here would send an operator looking for
          // data that is one tap away.
          <View className="flex-1 items-center justify-center gap-4 px-6">
            <EmptyState
              title={t`No work centers match`}
              description={t`${allColumns.length} are hidden by the filter.`}
            />
            <Button
              variant="secondary"
              onPress={() => setFilters(EMPTY_FILTERS)}
            >
              {t`Clear the filter`}
            </Button>
          </View>
        ) : (
          // A location with no work centers is real — a head office beside a
          // plant — and without a way out it reads as "the app lost them".
          // Name where they ARE, and put the picker one tap away.
          <View className="flex-1 items-center justify-center gap-4 px-6">
            <EmptyState
              title={t`No work centers at ${locationName}`}
              description={
                elsewhere.length > 0
                  ? t`This company's work centers are at ${elsewhere.join(", ")}.`
                  : t`Work centers appear here once they exist.`
              }
            />
            <Button
              variant="secondary"
              onPress={() => router.push("/(app)/context")}
            >
              {t`Change location`}
            </Button>
          </View>
        )
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="flex-1"
          // Paging on a phone so a column lands square rather than half shown.
          snapToInterval={isTablet ? undefined : columnWidth}
          decelerationRate="fast"
        >
          {columns.map((column) => (
            <Column
              key={column.id}
              title={column.title}
              active={column.active ?? false}
              isBlocked={column.isBlocked ?? false}
              operations={byColumn.get(column.id) ?? []}
              width={columnWidth}
              refreshing={refreshing}
              onRefresh={onRefresh}
            />
          ))}
        </ScrollView>
      )}
      <BoardFilterSheet
        ref={filterSheet}
        columns={allColumns}
        availableTags={query.data?.availableTags ?? []}
        filters={filters}
        onChange={setFilters}
      />
    </Screen>
  );
}
