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
import { WorkCenterStrip } from "~/features/operations/WorkCenterStrip";
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
  onRefresh,
  showHeader,
  customerNames
}: {
  title: string;
  active: boolean;
  isBlocked: boolean;
  operations: OperationCardData[];
  width: number;
  refreshing: boolean;
  onRefresh: () => void;
  /** False on a phone, where the strip above the board names the column. */
  showHeader: boolean;
  customerNames: Map<string, string>;
}) {
  const { t } = useLingui();

  return (
    <View
      className={`h-full ${showHeader ? "border-r border-border" : ""}`}
      style={{ width }}
    >
      {/*
        The column header, from `Kanban/components/ColumnCard.tsx`: the dot and
        the title, with the count beneath. A blocked centre turns the whole
        header destructive — the web does the same, because it is the one state
        an operator must see before walking to the machine.

        A phone shows one column at a time and names it in the strip above the
        board, so the header would say the same thing twice there; the blocked
        state is carried by the strip's chip and by the note below instead.
      */}
      {showHeader ? (
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
      ) : isBlocked ? (
        <View className="mx-3 mt-3 rounded-lg border border-destructive bg-destructive/10 p-3">
          <Text className="text-sm text-destructive">
            {t`${title} is blocked for maintenance`}
          </Text>
        </View>
      ) : null}

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
        renderItem={({ item }) => {
          const customerId = (item as { customerId?: unknown }).customerId;
          return (
            <OperationCard
              operation={item}
              customerName={
                typeof customerId === "string"
                  ? customerNames.get(customerId)
                  : null
              }
              onPress={() =>
                router.push(`/(app)/(tabs)/operations/${item.id}` as never)
              }
            />
          );
        }}
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

  // A phone shows ONE whole column, a page wide; the strip above the board is
  // what says there are more and where they are. (It used to show 86% of a
  // column with a sliver of the next as the only hint that the board scrolled
  // — which nobody read as "there are six more work centres".) A tablet shows
  // whole columns at a readable width, as many as fit.
  const columnWidth = isTablet ? 340 : screenWidth;
  const board = useRef<ScrollView>(null);
  const [currentColumn, setCurrentColumn] = useState(0);
  // The columns can change under the index: a filter, a refetch, another
  // location. Never point past the end of what is there.
  const shownColumn = Math.min(currentColumn, Math.max(0, columns.length - 1));

  // Customers arrive once for the whole board, not per card.
  const customerNames = useMemo(() => {
    const names = new Map<string, string>();
    const customers = (query.data as { customers?: unknown } | undefined)
      ?.customers;
    if (Array.isArray(customers)) {
      for (const customer of customers as { id?: unknown; name?: unknown }[]) {
        if (
          typeof customer?.id === "string" &&
          typeof customer.name === "string"
        ) {
          names.set(customer.id, customer.name);
        }
      }
    }
    return names;
  }, [query.data]);

  return (
    <Screen className="gap-2 px-0 pb-0 pt-2">
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

      <View className="flex-row items-center gap-2 pl-4">
        <Pressable
          onPress={() => filterSheet.current?.open()}
          accessibilityRole="button"
          accessibilityLabel={
            filterCount === 0
              ? t`Filter the board`
              : t`Filter the board, ${filterCount} active`
          }
          className={`min-h-[44px] flex-row items-center gap-2 rounded-full border px-3 active:opacity-70 ${
            filterCount > 0
              ? "border-primary bg-primary/10"
              : "border-border bg-card"
          }`}
        >
          <SlidersHorizontal size={16} color={colors.mutedForeground} />
          {/* The word only where there is room for it: on a phone this row is
              shared with every work centre on the floor. */}
          {isTablet || filterCount > 0 ? (
            <Text className="text-sm text-foreground">
              {filterCount === 0 ? t`Filter` : String(filterCount)}
            </Text>
          ) : null}
        </Pressable>

        {/* The work centres themselves, on a phone: the board shows one at a
            time, and this row is what says there are more. */}
        {!isTablet && columns.length > 0 ? (
          <View className="min-w-0 flex-1">
            <WorkCenterStrip
              columns={columns.map((column) => ({
                id: column.id,
                title: column.title,
                count: (byColumn.get(column.id) ?? []).length,
                active: column.active ?? false,
                isBlocked: column.isBlocked ?? false
              }))}
              current={shownColumn}
              onSelect={(index) => {
                setCurrentColumn(index);
                board.current?.scrollTo({
                  x: index * columnWidth,
                  animated: true
                });
              }}
            />
          </View>
        ) : null}
      </View>

      {/* A TOGGLE, not a dismissal: off is the whole floor and on is just
          this operator's station. It reads as a filter chip because that is
          what it is — the previous version looked like a notice with a close
          button, so an operator had no reason to think tapping it would bring
          six work centres back. Only shown when the operator actually has a
          station today. */}
      {stationName ? (
        <View className="px-4">
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
            className={`min-h-[44px] flex-row items-center gap-2 rounded-lg border px-3 active:opacity-70 ${
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
        </View>
      ) : null}

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
          ref={board}
          horizontal
          showsHorizontalScrollIndicator={false}
          className="flex-1"
          // One work centre per page on a phone, so a swipe moves exactly one
          // and a column never lands half shown.
          pagingEnabled={!isTablet}
          decelerationRate="fast"
          onMomentumScrollEnd={(event) => {
            if (isTablet) return;
            const x = event.nativeEvent.contentOffset.x;
            // Nearest page, by integer arithmetic on the offset.
            const index =
              (x + columnWidth / 2 - ((x + columnWidth / 2) % columnWidth)) /
              columnWidth;
            setCurrentColumn(index);
          }}
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
              showHeader={isTablet}
              customerNames={customerNames}
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
