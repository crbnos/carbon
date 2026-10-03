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
  EmptyState,
  ErrorNote,
  Heading,
  Muted,
  Screen,
  Skeleton
} from "~/components/ui";
import { useLayout } from "~/components/useLayout";
import { useThemeColors } from "~/components/useThemeColor";
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
  deviceToday,
  isStationDismissed,
  loadStationOverride,
  saveStationOverride
} from "~/features/operations/stationOverride";
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
  // The manning-board station default, and the operator's way out of it.
  //
  // Stored, not component state: web remembers the dismissal in a cookie for
  // the rest of the day, and holding it in `useState` meant it was forgotten
  // the moment this tab unmounted — so the board reopened on one column of a
  // seven-column board every time, with the dismissal apparently doing nothing.
  const { instanceId, companyId: scopeCompanyId } = useAuth();
  const scope = useMemo(
    () => ({
      instanceId: instanceId ?? "unknown",
      companyId: scopeCompanyId ?? ""
    }),
    [instanceId, scopeCompanyId]
  );
  const [dismissedDate, setDismissedDate] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadStationOverride(scope).then((date) => {
      if (cancelled) return;
      setDismissedDate(date);
    });
    return () => {
      cancelled = true;
    };
  }, [scope]);
  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS);
  const filterSheet = useRef<SheetHandle>(null);
  // `peopleDate` is the LOCATION's today and the date the server compares
  // against, so once a payload has arrived it is the authority; the device's
  // today is only the optimistic stand-in for the first request.
  const [serverDate, setServerDate] = useState<string | null>(null);
  const allWorkCenters = isStationDismissed(dismissedDate, {
    deviceDate: deviceToday(),
    serverDate
  });
  const query = useOperationsQuery([], allWorkCenters);

  // The floor moves while the operator is on another screen.
  useFocusEffect(
    useCallback(() => {
      void query.refetch();
    }, [query.refetch])
  );

  const payloadDate = query.data?.peopleDate ?? null;
  useEffect(() => {
    if (payloadDate) setServerDate(payloadDate);
  }, [payloadDate]);

  const locationName =
    me?.locations.find((l) => l.id === locationId)?.name ?? "";
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
      <View className="gap-1 px-4">
        <Heading>
          <Trans>Schedule</Trans>
        </Heading>
        <Muted className="text-sm">{locationName}</Muted>
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

        {query.data?.peopleStation && !allWorkCenters ? (
          <Pressable
            onPress={() => {
              // The server's own date, so the dismissal is compared against
              // exactly what it compares against — and lapses tomorrow.
              const date = payloadDate ?? deviceToday();
              setDismissedDate(date);
              void saveStationOverride(scope, date);
            }}
            accessibilityRole="button"
            accessibilityLabel={t`Show every work center`}
            className="min-h-[44px] flex-1 flex-row items-center gap-2 rounded-lg border border-border bg-card px-3 active:opacity-70"
          >
            <Factory size={16} color={colors.mutedForeground} />
            <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
              {t`Your station: ${query.data.peopleStation.name}`}
            </Text>
            <X size={16} color={colors.mutedForeground} />
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
        <EmptyState
          title={t`No work centers`}
          description={t`Work centers for ${locationName} appear here once they exist.`}
        />
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
              refreshing={query.isFetching}
              onRefresh={() => void query.refetch()}
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
