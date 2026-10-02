// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans, useLingui } from "@lingui/react/macro";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, View } from "react-native";
import {
  Body,
  EmptyState,
  ErrorNote,
  Heading,
  Muted,
  Screen,
  Skeleton
} from "~/components/ui";
import { OperationCard } from "~/features/operations/OperationCard";
import { useOperationsQuery } from "~/features/operations/useOperationsQuery";
import { useAuth } from "~/lib/auth/AuthProvider";

export default function Operations() {
  const { t } = useLingui();
  const { me, locationId } = useAuth();
  const [workCenterIds, setWorkCenterIds] = useState<string[]>([]);
  const query = useOperationsQuery(workCenterIds);

  // The floor moves while the operator is on another screen.
  useFocusEffect(
    useCallback(() => {
      void query.refetch();
    }, [query.refetch])
  );

  const locationName =
    me?.locations.find((l) => l.id === locationId)?.name ?? "";
  const columns = query.data?.columns ?? [];
  const selectedName = workCenterIds.length
    ? columns.find((c) => c.id === workCenterIds[0])?.title
    : null;

  return (
    <Screen className="gap-4 py-4">
      <View className="gap-1">
        <Heading>
          <Trans>Operations</Trans>
        </Heading>
        <Muted className="text-sm">{locationName}</Muted>
      </View>

      {columns.length > 1 ? (
        <FlatList
          horizontal
          data={[{ id: "", title: t`All` }, ...columns]}
          keyExtractor={(item) => item.id || "all"}
          showsHorizontalScrollIndicator={false}
          contentContainerClassName="gap-2"
          renderItem={({ item }) => {
            const selected = item.id
              ? workCenterIds.includes(item.id)
              : workCenterIds.length === 0;
            return (
              <Pressable
                onPress={() => setWorkCenterIds(item.id ? [item.id] : [])}
                className={`min-h-[48px] justify-center rounded-full border px-4 ${
                  selected ? "border-ring bg-accent" : "border-border bg-card"
                }`}
              >
                <Body className="text-sm">{item.title}</Body>
              </Pressable>
            );
          }}
        />
      ) : null}

      {query.isError ? (
        <ErrorNote>
          {query.error instanceof Error
            ? query.error.message
            : t`Could not load operations`}
        </ErrorNote>
      ) : null}

      {query.isPending ? (
        // A skeleton, never an empty screen: an operator must be able to tell
        // "still loading" from "nothing to do".
        <View className="gap-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </View>
      ) : (
        <FlatList
          data={query.data?.items ?? []}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={() => <View className="h-3" />}
          contentContainerClassName="pb-6"
          refreshControl={
            <RefreshControl
              refreshing={query.isFetching}
              onRefresh={() => void query.refetch()}
            />
          }
          ListEmptyComponent={
            <EmptyState
              title={
                selectedName
                  ? t`No operations at ${selectedName}`
                  : t`No operations at ${locationName}`
              }
              description={t`Work shows up here as soon as it is scheduled.`}
            />
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
