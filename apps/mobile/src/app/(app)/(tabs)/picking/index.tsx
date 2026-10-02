// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { Trans, useLingui } from "@lingui/react/macro";
import { router, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import {
  EmptyState,
  ErrorNote,
  Heading,
  Muted,
  Screen,
  Skeleton
} from "~/components/ui";
import { commandMessage } from "~/features/picking/commands";
import { PickingListCard } from "~/features/picking/PickingListCard";
import { usePickingQuery } from "~/features/picking/usePickingQueries";
import { useAuth } from "~/lib/auth/AuthProvider";

/**
 * The kitter's assigned picking lists — `x+/picking._index.tsx` on the web,
 * through the same `getPickingScreen`, so the two cannot disagree about whose
 * list this is.
 *
 * Refetched on focus as well as on its interval: a kitter comes back to this
 * tab after filling a box, and a card still reading "6 of 14" for a list they
 * just finished is the one thing that makes them doubt the tablet.
 */
export default function PickingLists() {
  const { t } = useLingui();
  const { me, locationId } = useAuth();
  const query = usePickingQuery();

  useFocusEffect(
    useCallback(() => {
      void query.refetch();
    }, [query.refetch])
  );

  const locationName =
    me?.locations.find((location) => location.id === locationId)?.name ?? "";

  return (
    <Screen className="gap-4 py-4">
      <View className="gap-1">
        <Heading>
          <Trans>Picking</Trans>
        </Heading>
        {locationName ? (
          <Muted className="text-sm">{locationName}</Muted>
        ) : null}
      </View>

      {query.isError ? (
        <ErrorNote>
          {commandMessage(query.error, t`Could not load your picking lists`)}
        </ErrorNote>
      ) : null}

      {query.isPending ? (
        // A skeleton, never an empty screen: a kitter must be able to tell
        // "still loading" from "nothing assigned to me".
        <View className="gap-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </View>
      ) : (
        <FlatList
          data={query.data?.pickingLists ?? []}
          keyExtractor={(list) => list.id}
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
              title={t`No picking lists assigned`}
              description={t`A list shows up here as soon as it is assigned to you.`}
            />
          }
          renderItem={({ item }) => (
            <PickingListCard
              list={item}
              onPress={() =>
                router.push(`/(app)/(tabs)/picking/${item.id}` as never)
              }
            />
          )}
        />
      )}
    </Screen>
  );
}
