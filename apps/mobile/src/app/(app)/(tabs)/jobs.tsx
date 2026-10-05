// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import Animated, {
  Easing,
  FadeInDown,
  FadeOut,
  LinearTransition
} from "react-native-reanimated";
import { DURATION, EASE } from "~/components/motion";
import {
  EmptyState,
  ErrorNote,
  Field,
  Heading,
  Muted,
  Screen,
  Skeleton
} from "~/components/ui";
import { usePullToRefresh } from "~/components/usePullToRefresh";
import { JobCard } from "~/features/jobs/JobCard";
import { useJobsQuery } from "~/features/jobs/useJobsQuery";
import { commandMessage } from "~/features/operations/commands";

/**
 * Every open job at the location — web MES's `x+/jobs.tsx`, through
 * `GET /api/v1/jobs` and so through the same read.
 *
 * Search is client-side over the loaded list, as it is on web: the whole
 * location's open jobs are already in hand, so filtering is instant and a
 * shop floor's Wi-Fi is not involved.
 */
export default function Jobs() {
  const { t } = useLingui();
  const query = useJobsQuery();
  const { refreshing, onRefresh } = usePullToRefresh(query.refetch);
  const [search, setSearch] = useState("");

  // The floor moves while the operator is on another screen.
  useFocusEffect(
    useCallback(() => {
      void query.refetch();
    }, [query.refetch])
  );

  const jobs = useMemo(() => {
    const all = query.data?.jobs ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return all;
    // The same three fields web searches: the job number, the part, and the
    // description an operator would recognise it by.
    return all.filter(
      (job) =>
        job.jobId?.toLowerCase().includes(term) ||
        job.itemReadableIdWithRevision?.toLowerCase().includes(term) ||
        job.name?.toLowerCase().includes(term)
    );
  }, [query.data?.jobs, search]);

  const trackedEntities = query.data?.trackedEntities ?? {};

  return (
    <Screen className="gap-3 py-4">
      <View className="px-4">
        <Heading>{t`Jobs`}</Heading>
      </View>

      <View className="px-4">
        <Field
          value={search}
          onChangeText={setSearch}
          placeholder={t`Search`}
          accessibilityLabel={t`Search the jobs`}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      {query.isError ? (
        <View className="px-4">
          <ErrorNote>
            {commandMessage(query.error, t`Could not load the jobs`)}
          </ErrorNote>
        </View>
      ) : null}

      {query.isPending ? (
        <View className="gap-3 px-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </View>
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={(job) => job.id}
          ItemSeparatorComponent={() => <View className="h-3" />}
          contentContainerClassName="px-4 pb-8"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            search ? (
              <Muted className="px-1 py-6 text-center text-sm">
                {t`No job matches "${search}".`}
              </Muted>
            ) : (
              <EmptyState
                title={t`No open jobs`}
                description={t`Jobs released at this location will appear here.`}
              />
            )
          }
          renderItem={({ item, index }) => (
            <Animated.View
              entering={FadeInDown.duration(DURATION.quick)
                .easing(Easing.bezier(...EASE.out))
                .delay(Math.min(index, 5) * 35)}
              exiting={FadeOut.duration(DURATION.instant)}
              layout={LinearTransition.duration(DURATION.settle).easing(
                Easing.bezier(...EASE.inOut)
              )}
            >
              <JobCard
                job={item}
                trackingId={
                  item.jobMakeMethodId
                    ? (trackedEntities[item.jobMakeMethodId] ?? null)
                    : null
                }
              />
            </Animated.View>
          )}
        />
      )}
    </Screen>
  );
}
