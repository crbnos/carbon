// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { useLingui } from "@lingui/react/macro";
import { router, useLocalSearchParams } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { useMemo } from "react";
import { FlatList, RefreshControl, Text, View } from "react-native";
import Animated, {
  Easing,
  FadeInDown,
  LinearTransition
} from "react-native-reanimated";
import { DURATION, EASE } from "~/components/motion";
import { PressableScale } from "~/components/PressableScale";
import { StatusBadge } from "~/components/StatusBadge";
import {
  Card,
  EmptyState,
  ErrorNote,
  Heading,
  Muted,
  Screen,
  Skeleton
} from "~/components/ui";
import { usePullToRefresh } from "~/components/usePullToRefresh";
import { useThemeColors } from "~/components/useThemeColor";
import { orderOperations } from "~/features/jobs/jobOrder";
import { useJobQuery } from "~/features/jobs/useJobsQuery";
import { commandMessage } from "~/features/operations/commands";

/**
 * One job's operations — web MES's `x+/job.$jobId.tsx`.
 *
 * Web draws them as a node graph and opens an operation when a node is
 * tapped. This is a LIST that does the same thing: a graph on a tablet needs
 * pan, zoom and fit before it can be read, and an operator opening a job is
 * asking "which operation do I work on", not "what is the topology". The
 * ordering still comes from the dependency edges (`orderOperations`), so the
 * sequence is the one the job actually runs in rather than the column a
 * planner typed.
 *
 * Outside the tabs, like the operation and assembly screens: this is a
 * drill-down from the Jobs list, not a destination of its own.
 */
export default function JobRoute() {
  const { t } = useLingui();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useJobQuery(id ?? "");
  const { refreshing, onRefresh } = usePullToRefresh(query.refetch);

  const operations = useMemo(
    () =>
      orderOperations(
        query.data?.operations ?? [],
        query.data?.dependencies ?? []
      ),
    [query.data?.operations, query.data?.dependencies]
  );

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
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </View>
      ) : (
        <FlatList
          data={operations}
          keyExtractor={(operation) => operation.id}
          ItemSeparatorComponent={() => <View className="h-3" />}
          contentContainerClassName="px-4 pb-8"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <EmptyState
              title={t`No operations`}
              description={t`This job has no operations yet.`}
            />
          }
          renderItem={({ item, index }) => (
            <Animated.View
              entering={FadeInDown.duration(DURATION.quick)
                .easing(Easing.bezier(...EASE.out))
                .delay(Math.min(index, 5) * 35)}
              layout={LinearTransition.duration(DURATION.settle).easing(
                Easing.bezier(...EASE.inOut)
              )}
            >
              <OperationRow operation={item} step={index + 1} />
            </Animated.View>
          )}
        />
      )}
    </Screen>
  );
}

function OperationRow({
  operation,
  step
}: {
  operation: {
    id: string;
    description?: string | null;
    status?: string | null;
    quantityComplete?: number | null;
    operationQuantity?: number | null;
  };
  step: number;
}) {
  const { t } = useLingui();
  const colors = useThemeColors();

  return (
    <PressableScale
      // The same destination web's node tap has: the operation screen. It is
      // the one outside the tabs, so it covers this list exactly as it covers
      // the board.
      onPress={() => router.push(`/(app)/operation/${operation.id}` as never)}
      accessibilityRole="button"
      accessibilityLabel={t`Open operation ${operation.description ?? ""}`}
    >
      <Card className="flex-row items-center gap-3">
        {/* The position in the running order, which is the only thing a flat
            list can say about a graph the operator cannot see. */}
        <View className="h-8 w-8 items-center justify-center rounded-full bg-muted">
          <Text className="text-sm font-semibold text-foreground">{step}</Text>
        </View>
        <View className="min-w-0 flex-1 gap-0.5">
          <Text
            className="text-base font-semibold text-foreground"
            numberOfLines={2}
          >
            {operation.description ?? ""}
          </Text>
          <Muted className="text-sm">
            {operation.quantityComplete ?? 0} /{" "}
            {operation.operationQuantity ?? 0}
          </Muted>
        </View>
        {operation.status ? (
          <StatusBadge entity="jobOperation" status={operation.status} />
        ) : null}
        <ChevronRight size={18} color={colors.mutedForeground} />
      </Card>
    </PressableScale>
  );
}
