import { requirePermissions } from "@carbon/auth/auth.server";
import type { Database } from "@carbon/database";
import { Button, Loading, useHydrated, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ParentSize } from "@visx/responsive";
import { ReactFlowProvider, useReactFlow, useStore } from "@xyflow/react";
import XYFlowStyle from "@xyflow/react/dist/style.css?url";
import { useCallback, useMemo, useState } from "react";
import type { LinksFunction, LoaderFunctionArgs } from "react-router";
import { Link, redirect, useLoaderData, useNavigation } from "react-router";
import { Empty } from "~/components";
import type { Activity, TrackedEntity } from "~/modules/inventory";
import {
  fetchContainmentsForEntities,
  fetchJobScopedLineage,
  fetchLineageSubgraph,
  type LineagePayload
} from "~/modules/inventory/lineage.server";
import { clampDepth } from "~/modules/inventory/ui/Traceability/constants";
import { TraceabilityGraph } from "~/modules/inventory/ui/Traceability/TraceabilityGraph";
import { TraceabilitySidebar } from "~/modules/inventory/ui/Traceability/TraceabilitySidebar";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: XYFlowStyle }
];

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

  if (trackedEntityId) {
    let payload = await fetchLineageSubgraph(
      client,
      trackedEntityId,
      depth,
      "both"
    );
    const rootEntity = payload.entities.find((e) => e.id === trackedEntityId);
    const associatedJobId = jobId ?? getEntityJobId(rootEntity);

    if (associatedJobId) {
      const jobPayload = await fetchJobScopedLineage(
        client,
        associatedJobId,
        depth
      );
      const jobReadableId = await getJobReadableId(client, associatedJobId);
      payload = mergeLineagePayloads(
        payload,
        withJobNode(jobPayload, associatedJobId, jobReadableId)
      );
    }

    const containments = await fetchContainmentsForEntities(
      client,
      payload.entities.map((e) => e.id)
    );
    return {
      ...payload,
      containments,
      rootId: trackedEntityId,
      rootType: "entity" as const,
      depth
    };
  }

  if (jobId) {
    const jobReadableId = await getJobReadableId(client, jobId);
    const payload = withJobNode(
      await fetchJobScopedLineage(client, jobId, depth),
      jobId,
      jobReadableId
    );
    return {
      ...payload,
      rootId: jobId,
      rootType: "job" as const,
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

  const containments = await fetchContainmentsForEntities(
    client,
    allEntities.map((e) => e.id)
  );

  return {
    entities: allEntities,
    inputs: [...(directInputs?.data || []), ...(additionalInputs?.data || [])],
    outputs: [
      ...(directOutputs?.data || []),
      ...(additionalOutputs?.data || [])
    ],
    activities: allActivities,
    containments,
    rootId: trackedActivityId!,
    rootType: "activity" as const,
    depth: 1
  };
}

function getEntityJobId(entity: TrackedEntity | undefined): string | null {
  const attrs = entity?.attributes;
  if (!attrs || typeof attrs !== "object" || Array.isArray(attrs)) return null;
  const job = (attrs as Record<string, unknown>).Job;
  return typeof job === "string" && job.length > 0 ? job : null;
}

async function getJobReadableId(
  client: SupabaseClient<Database>,
  jobId: string
): Promise<string> {
  const job = await client.from("job").select("jobId").eq("id", jobId).single();
  return job.data?.jobId ?? jobId;
}

function withJobNode(
  payload: LineagePayload,
  jobId: string,
  jobReadableId: string
): LineagePayload {
  const jobNodeId = `job:${jobId}`;
  const existingActivityIds = new Set(payload.activities.map((a) => a.id));
  const existingOutputKeys = new Set(
    payload.outputs.map((o) => `${o.trackedActivityId}:${o.trackedEntityId}`)
  );
  const jobEntities = payload.entities.filter((entity) => {
    if (getEntityJobId(entity) !== jobId) return false;
    return entity.status === "Reserved" || entity.sourceDocument === "Item";
  });

  return {
    ...payload,
    activities: existingActivityIds.has(jobNodeId)
      ? payload.activities
      : [
          {
            id: jobNodeId,
            type: "Job",
            sourceDocument: "Job",
            sourceDocumentId: jobId,
            sourceDocumentReadableId: jobReadableId,
            attributes: { Job: jobId }
          },
          ...payload.activities
        ],
    outputs: [
      ...payload.outputs,
      ...jobEntities
        .map((entity) => ({
          trackedActivityId: jobNodeId,
          trackedEntityId: entity.id,
          quantity: entity.quantity
        }))
        .filter(
          (output) =>
            !existingOutputKeys.has(
              `${output.trackedActivityId}:${output.trackedEntityId}`
            )
        )
    ]
  };
}

function mergeLineagePayloads(
  base: LineagePayload,
  incoming: LineagePayload
): LineagePayload {
  const entityIds = new Set(base.entities.map((e) => e.id));
  const activityIds = new Set(base.activities.map((a) => a.id));
  const inputKeys = new Set(
    base.inputs.map((i) => `${i.trackedActivityId}:${i.trackedEntityId}`)
  );
  const outputKeys = new Set(
    base.outputs.map((o) => `${o.trackedActivityId}:${o.trackedEntityId}`)
  );
  const baseContainments = base.containments ?? [];
  const incomingContainments = incoming.containments ?? [];
  const containmentKeys = new Set(
    baseContainments.map((c) => `${c.id}:${c.trackedEntityId}`)
  );

  return {
    entities: [
      ...base.entities,
      ...incoming.entities.filter((e) => !entityIds.has(e.id))
    ],
    activities: [
      ...base.activities,
      ...incoming.activities.filter((a) => !activityIds.has(a.id))
    ],
    inputs: [
      ...base.inputs,
      ...incoming.inputs.filter(
        (i) => !inputKeys.has(`${i.trackedActivityId}:${i.trackedEntityId}`)
      )
    ],
    outputs: [
      ...base.outputs,
      ...incoming.outputs.filter(
        (o) => !outputKeys.has(`${o.trackedActivityId}:${o.trackedEntityId}`)
      )
    ],
    stepRecords: base.stepRecords ?? incoming.stepRecords,
    containments:
      incomingContainments.length === 0 && baseContainments.length === 0
        ? undefined
        : [
            ...baseContainments,
            ...incomingContainments.filter(
              (c) => !containmentKeys.has(`${c.id}:${c.trackedEntityId}`)
            )
          ]
  };
}

export default function TraceabilityRoute() {
  return (
    <ReactFlowProvider>
      <TraceabilityRouteInner />
    </ReactFlowProvider>
  );
}

function TraceabilityRouteInner() {
  const {
    entities,
    inputs,
    outputs,
    activities,
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

  // Selection lives in the React Flow store. Subscribe to the nodes ref
  // (stable until xyflow updates it) and derive ids via useMemo so the
  // returned array stays referentially stable across unrelated renders.
  const flowNodes = useStore((s) => s.nodes);
  const selectedIds = useMemo(() => {
    const ids: string[] = [];
    for (let i = 0; i < flowNodes.length; i++) {
      if (flowNodes[i].selected) ids.push(flowNodes[i].id);
    }
    return ids;
  }, [flowNodes]);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const safeIndex =
    selectedIds.length > 0 ? Math.min(focusedIndex, selectedIds.length - 1) : 0;
  const focusedSelectedId = selectedIds[safeIndex] ?? null;
  const rootHasNode =
    entities.some((e) => e?.id === rootId) ||
    activities.some((a) => a?.id === rootId);
  const fallbackSidebarId = rootHasNode
    ? rootId
    : (entities[0]?.id ?? activities[0]?.id ?? rootId);
  const sidebarId = focusedSelectedId ?? fallbackSidebarId;

  const { setNodes } = useReactFlow();
  const selectNode = useCallback(
    (id: string | null) => {
      setNodes((nodes) =>
        nodes.map((n) => {
          const wantsSelected = id !== null && n.id === id;
          if (n.selected === wantsSelected) return n;
          return { ...n, selected: wantsSelected };
        })
      );
    },
    [setNodes]
  );

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
            containments
          }}
          onSelect={selectNode}
          focusedIndex={safeIndex}
          onFocusedIndexChange={setFocusedIndex}
          selectedIds={selectedIds}
        />
      )}
    </div>
  );
}
