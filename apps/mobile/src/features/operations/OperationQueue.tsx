// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { OperationQueueScreen } from "@carbon/mes-core";
import { useLingui } from "@lingui/react/macro";
import type { UseQueryResult } from "@tanstack/react-query";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import {
  Body,
  Button,
  ErrorNote,
  Field,
  Heading,
  Screen,
  Skeleton
} from "~/components/ui";
import { OperationCard } from "./OperationCard";
import { QueueSwitcher, type QueueView } from "./QueueSwitcher";
import { filterOperationCards, toOperationCard } from "./queues";

/**
 * The body of all three personal queues — Assigned, Active and Recent.
 *
 * One component because web MES has one too: all three of its routes render the
 * same `OperationsList` under a heading and a search box, and differ only in
 * which read fills it and what the empty state says. The card is this app's
 * existing `OperationCard`, which is already a port of the web card, so a
 * queue row and a board card read identically.
 *
 * The list is a flat column, not the board's horizontal columns. These queues
 * are already scoped to one person, so there is nothing to split by work
 * centre — and on the web these three are exactly the screens that use the flat
 * card list rather than the Kanban.
 */

/**
 * Only what the body reads. `Pick` over `UseQueryResult` rather than the whole
 * union so the three screens can hand over their own query without this
 * component caring which endpoint filled it.
 */
type QueueQuery = Pick<
  UseQueryResult<OperationQueueScreen>,
  "data" | "error" | "isError" | "isFetching" | "isPending" | "refetch"
>;

export function OperationQueue({
  view,
  title,
  emptyTitle,
  query
}: {
  view: QueueView;
  title: string;
  /** What to say when the queue is genuinely empty — never while loading. */
  emptyTitle: string;
  query: QueueQuery;
}) {
  const { t } = useLingui();
  const [search, setSearch] = useState("");
  const refetch = query.refetch;

  // The floor moves while the operator is on another screen: a supervisor
  // reassigns work, another operator stops a timer they were sharing.
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch])
  );

  const cards = useMemo(
    () => (query.data?.operations ?? []).map(toOperationCard),
    [query.data?.operations]
  );
  const visible = useMemo(
    () => filterOperationCards(cards, search),
    [cards, search]
  );

  return (
    // `px-0` on the Screen: the switcher owns its own gutter and the list's
    // gutter is its content container's, as on the board.
    <Screen className="gap-3 px-0 py-4">
      <View className="px-4">
        <Heading>{title}</Heading>
      </View>

      <QueueSwitcher current={view} />

      <View className="px-4">
        <Field
          value={search}
          onChangeText={setSearch}
          placeholder={t`Search`}
          accessibilityLabel={t`Search`}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
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
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={() => <View className="h-3" />}
          contentContainerClassName="px-4 pb-8"
          refreshControl={
            <RefreshControl
              refreshing={query.isFetching}
              onRefresh={() => void refetch()}
            />
          }
          // Deliberately not `EmptyState`, which is `flex-1`: a flexed child of
          // a scroll view's content container has no parent height to take a
          // fraction of and collapses to nothing on native.
          ListEmptyComponent={
            <View className="items-center gap-4 py-16">
              <Body className="font-semibold">
                {search ? t`No results exist` : emptyTitle}
              </Body>
              {search ? (
                <Button variant="secondary" onPress={() => setSearch("")}>
                  {t`Clear Search`}
                </Button>
              ) : null}
            </View>
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
      )}
    </Screen>
  );
}
