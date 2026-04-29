import { requirePermissions } from "@carbon/auth/auth.server";
import { Button, Loading, useHydrated, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ParentSize } from "@visx/responsive";
import { useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Link, redirect, useLoaderData, useNavigation } from "react-router";
import { Empty } from "~/components";
import type { Activity, TrackedEntity } from "~/modules/inventory";
import { fetchLineageSubgraph } from "~/modules/inventory/lineage.server";
import { TraceabilityGraph } from "~/modules/inventory/ui/Traceability/TraceabilityGraph";
import { TraceabilitySidebar } from "~/modules/inventory/ui/Traceability/TraceabilitySidebar";
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
  const depthParam = url.searchParams.get("depth");
  const depth = Math.min(Math.max(1, Number(depthParam) || 2), 5);

  if (!trackedEntityId && !trackedActivityId) {
    throw redirect(path.to.traceability);
  }

  if (trackedEntityId) {
    const payload = await fetchLineageSubgraph(
      client,
      trackedEntityId,
      depth,
      "both"
    );
    return {
      ...payload,
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

  return {
    entities: (directEntities?.data ?? []) as TrackedEntity[],
    inputs: [...(directInputs?.data || []), ...(additionalInputs?.data || [])],
    outputs: [
      ...(directOutputs?.data || []),
      ...(additionalOutputs?.data || [])
    ],
    activities: [
      ...((activity?.data || []) as unknown as Activity[]),
      ...((additionalActivities?.data || []) as unknown as Activity[])
    ],
    rootId: trackedActivityId!,
    rootType: "activity" as const,
    depth: 1
  };
}

export default function TraceabilityRoute() {
  const { entities, inputs, outputs, activities, rootId, rootType } =
    useLoaderData<typeof loader>();

  const isEmpty = useMemo(
    () => entities.length === 0 && activities.length === 0,
    [entities, activities]
  );

  const isHydrated = useHydrated();
  const navigation = useNavigation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sidebarId = selectedId ?? rootId;

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
                      rootId={rootId}
                      rootType={rootType}
                      width={width}
                      height={height}
                      selectedId={selectedId}
                      onSelect={(id) => setSelectedId(id)}
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
          key={`sidebar-${selectedId}`}
          entity={selectedEntity}
          activity={selectedActivity}
        />
      )}
    </div>
  );
}
