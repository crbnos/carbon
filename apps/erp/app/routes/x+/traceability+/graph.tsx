import { requirePermissions } from "@carbon/auth/auth.server";
import { Button, Loading, useHydrated, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ParentSize } from "@visx/responsive";
import { useMemo } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Link, redirect, useLoaderData, useNavigation } from "react-router";
import { Empty } from "~/components";
import type { Activity, TrackedEntity } from "~/modules/inventory";
import {
  fetchContainmentsForEntities,
  fetchJobScopedLineage,
  fetchJobStepRecords,
  fetchLineageSubgraph
} from "~/modules/inventory/lineage.server";
import { clampDepth } from "~/modules/inventory/ui/Traceability/constants";
import { useTraceabilityStore } from "~/modules/inventory/ui/Traceability/store";
import { TraceabilityGraph } from "~/modules/inventory/ui/Traceability/TraceabilityGraph";
import { TraceabilitySidebar } from "~/modules/inventory/ui/Traceability/TraceabilitySidebar";
import type { StepRecord } from "~/modules/inventory/ui/Traceability/utils";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Traceability`,
  to: path.to.traceability,
  module: "inventory"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "inventory",
    bypassRls: true
  });

  const url = new URL(request.url);
  const trackedEntityId = url.searchParams.get("trackedEntityId");
  const trackedActivityId = url.searchParams.get("trackedActivityId");
  const jobId = url.searchParams.get("jobId");
  const depthParam = url.searchParams.get("depth");
  const depth = clampDepth(Number(depthParam) || 1);

  if (!trackedEntityId && !trackedActivityId && !jobId) {
    throw redirect(path.to.traceability);
  }

  if (jobId) {
    const payload = await fetchJobScopedLineage(client, jobId, depth);
    return {
      ...payload,
      stepRecords: payload.stepRecords ?? [],
      containments: payload.containments ?? [],
      rootId: jobId,
      rootType: "job" as const,
      depth
    };
  }

  if (trackedEntityId) {
    const payload = await fetchLineageSubgraph(
      client,
      trackedEntityId,
      depth,
      "both"
    );
    const [containments, stepRecords] = await Promise.all([
      fetchContainmentsForEntities(
        client,
        payload.entities.map((e) => e.id)
      ),
      collectStepRecordsForActivities(client, payload.activities)
    ]);
    return {
      ...payload,
      stepRecords,
      containments,
      rootId: trackedEntityId,
      rootType: "entity" as const,
      depth
    };
  }

  // Legacy 1-hop activity-rooted view.
  const [activity, directInputs, directOutputs] = await Promise.all([
    client.from("trackedActivity").select("*").eq("id", trackedActivityId!),
    client
      .from("trackedActivityInput")
      .select("*")
      .eq("trackedActivityId", trackedActivityId!),
    client
      .from("trackedActivityOutput")
      .select("*")
      .eq("trackedActivityId", trackedActivityId!)
  ]);

  const directEntityIds = Array.from(
    new Set([
      ...(directInputs?.data?.map((input) => input.trackedEntityId) || []),
      ...(directOutputs?.data?.map((output) => output.trackedEntityId) || [])
    ])
  );

  const directEntities = await client
    .from("trackedEntity")
    .select("*")
    .in("id", directEntityIds);

  const [additionalInputs, additionalOutputs] = await Promise.all([
    client
      .from("trackedActivityInput")
      .select("*")
      .in("trackedEntityId", directEntityIds)
      .neq("trackedActivityId", trackedActivityId!),
    client
      .from("trackedActivityOutput")
      .select("*")
      .in("trackedEntityId", directEntityIds)
      .neq("trackedActivityId", trackedActivityId!)
  ]);

  const additionalActivityIds = Array.from(
    new Set([
      ...(additionalInputs?.data?.map((input) => input.trackedActivityId) ||
        []),
      ...(additionalOutputs?.data?.map((output) => output.trackedActivityId) ||
        [])
    ])
  );

  const additionalActivities = await client
    .from("trackedActivity")
    .select("*")
    .in("id", additionalActivityIds);

  const allEntities = (directEntities?.data ?? []) as TrackedEntity[];
  const allActivities = [
    ...((activity?.data || []) as unknown as Activity[]),
    ...((additionalActivities?.data || []) as unknown as Activity[])
  ];

  const [containments, stepRecords] = await Promise.all([
    fetchContainmentsForEntities(
      client,
      allEntities.map((e) => e.id)
    ),
    collectStepRecordsForActivities(client, allActivities)
  ]);

  return {
    entities: allEntities,
    inputs: [...(directInputs?.data || []), ...(additionalInputs?.data || [])],
    outputs: [
      ...(directOutputs?.data || []),
      ...(additionalOutputs?.data || [])
    ],
    activities: allActivities,
    stepRecords,
    containments,
    rootId: trackedActivityId!,
    rootType: "activity" as const,
    depth: 1
  };
}

async function collectStepRecordsForActivities(
  client: Parameters<typeof fetchJobStepRecords>[0],
  activities: Activity[]
): Promise<StepRecord[]> {
  const jobIds = new Set<string>();
  for (const a of activities) {
    const jobId = (a.attributes as Record<string, unknown> | null)?.Job;
    if (typeof jobId === "string" && jobId) jobIds.add(jobId);
  }
  if (jobIds.size === 0) return [];
  const results = await Promise.all(
    Array.from(jobIds).map((jobId) => fetchJobStepRecords(client, jobId))
  );
  return results.flat();
}

export default function TraceabilityRoute() {
  const {
    entities,
    inputs,
    outputs,
    activities,
    stepRecords,
    containments,
    rootId,
    rootType
  } = useLoaderData<typeof loader>();

  const isEmpty = useMemo(
    () => entities.length === 0 && activities.length === 0,
    [entities, activities]
  );

  const isHydrated = useHydrated();
  const navigation = useNavigation();

  const selectedIds = useTraceabilityStore((s) => s.selectedIds);
  const focusedIndex = useTraceabilityStore((s) => s.focusedIndex);
  const setSelectedSingle = useTraceabilityStore((s) => s.setSelectedSingle);
  const safeIndex =
    selectedIds.length > 0 ? Math.min(focusedIndex, selectedIds.length - 1) : 0;
  const focusedSelectedId = selectedIds[safeIndex] ?? null;
  const sidebarId = focusedSelectedId ?? rootId;

  const selectedEntity =
    (entities.find((e) => e?.id === sidebarId) as TrackedEntity | undefined) ??
    null;
  const selectedActivity =
    (activities.find((a) => a?.id === sidebarId) as Activity | undefined) ??
    null;

  return (
    <div className="flex bg-card h-[calc(100dvh-49px)] w-full overflow-hidden scrollbar-hide">
      <VStack className="flex-1 min-w-0 h-full" spacing={0}>
        <div className="flex flex-1 w-full h-full overflow-hidden">
          <div className="w-full h-full">
            {isEmpty ? (
              <Empty className="h-full w-full">
                <Button asChild>
                  <Link to={path.to.traceability}>
                    <Trans>Back to traceability</Trans>
                  </Link>
                </Button>
              </Empty>
            ) : (
              <ParentSize>
                {({ width, height }) => (
                  <Loading
                    isLoading={!isHydrated || navigation.state !== "idle"}
                  >
                    <TraceabilityGraph
                      key={`graph-${rootId}`}
                      entities={entities as TrackedEntity[]}
                      activities={activities as Activity[]}
                      inputs={inputs}
                      outputs={outputs}
                      stepRecords={stepRecords}
                      containments={containments}
                      rootId={rootId}
                      rootType={rootType}
                      width={width}
                      height={height}
                    />
                  </Loading>
                )}
              </ParentSize>
            )}
          </div>
        </div>
      </VStack>
      {!isEmpty && (
        <TraceabilitySidebar
          key={`sidebar-${sidebarId}`}
          entity={selectedEntity}
          activity={selectedActivity}
          payload={{
            entities: entities as TrackedEntity[],
            activities: activities as Activity[],
            inputs,
            outputs,
            stepRecords,
            containments
          }}
          onSelect={(id) => setSelectedSingle(id)}
        />
      )}
    </div>
  );
}
