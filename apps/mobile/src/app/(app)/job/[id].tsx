// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { router, useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { PressableScale } from "~/components/PressableScale";
import { StatusBadge } from "~/components/StatusBadge";
import { ErrorNote, Heading, Screen, Skeleton } from "~/components/ui";
import { JobGraph } from "~/features/jobs/JobGraph";
import { useJobQuery } from "~/features/jobs/useJobsQuery";
import { commandMessage } from "~/features/operations/commands";

/**
 * One job's operations — web MES's `x+/job.$jobId.tsx`.
 *
 * The GRAPH, as on web: nodes joined by their dependency edges, pan and
 * pinch to move around it, tap a node to open that operation. A job can fan
 * out and rejoin, and the graph is the only shape that shows it — an earlier
 * version of this screen was a flat list, which read the sequence correctly
 * but could not say that two operations run in parallel.
 *
 * Outside the tabs, like the operation and assembly screens: this is a
 * drill-down from the Jobs list, not a destination of its own.
 */
export default function JobRoute() {
  const { t } = useLingui();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useJobQuery(id ?? "");

  const job = query.data?.job;

  return (
    <Screen className="gap-3 py-4">
      <View className="flex-row items-center gap-3 px-4">
        <PressableScale
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={t`Back`}
          className="min-h-[44px] justify-center pr-2"
        >
          <Text className="text-base text-muted-foreground">{t`Back`}</Text>
        </PressableScale>
        <Heading className="flex-1">{job?.jobId ?? ""}</Heading>
        {job?.status ? <StatusBadge entity="job" status={job.status} /> : null}
      </View>

      {query.isError ? (
        <View className="px-4">
          <ErrorNote>
            {commandMessage(query.error, t`Could not load the job`)}
          </ErrorNote>
        </View>
      ) : null}

      {query.isPending ? (
        <View className="gap-3 px-4">
          <Skeleton className="flex-1" />
        </View>
      ) : (
        <JobGraph
          operations={query.data?.operations ?? []}
          dependencies={query.data?.dependencies ?? []}
        />
      )}
    </Screen>
  );
}
