import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Button,
  HStack,
  Heading,
  Loading,
  VStack,
  useHydrated,
} from "@carbon/react";
import { useUrlParams } from "@carbon/remix";
import { Link, useLoaderData, useNavigation } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ParentSize } from "@visx/responsive";
import { useEffect, useMemo, useState } from "react";
import { Empty } from "~/components";
import type {
  Activity,
  ActivityInput,
  ActivityOutput,
  GraphData,
  GraphLink,
  GraphNode,
  TrackedEntity,
} from "~/modules/inventory";
import {
  TraceabilityGraph,
  TraceabilitySidebar,
} from "~/modules/inventory/ui/Traceability/TraceabilityGraph";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Traceability",
  to: path.to.traceability,
  module: "inventory",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "inventory",
    bypassRls: true,
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const trackedEntityId = searchParams.get("trackedEntityId");
  const trackedActivityId = searchParams.get("trackedActivityId");

  if (!trackedEntityId && !trackedActivityId) {
    throw redirect(path.to.traceability);
  }

  if (trackedEntityId) {
    const [entity, descendants, ancestors] = await Promise.all([
      client
        .from("trackedEntity")
        .select("*")
        .eq("id", trackedEntityId)
        .single(),
      client.rpc("get_direct_descendants_of_tracked_entity_strict", {
        p_tracked_entity_id: trackedEntityId,
      }),
      client.rpc("get_direct_ancestors_of_tracked_entity_strict", {
        p_tracked_entity_id: trackedEntityId,
      }),
    ]);

    const [inputs, outputs] = await Promise.all([
      client
        .from("trackedActivityInput")
        .select("*")
        .in(
          "trackedEntityId",
          Array.from(
            new Set([
              ...(descendants?.data?.map((descendant) => descendant.id) || []),
              trackedEntityId,
            ])
          )
        ),
      client
        .from("trackedActivityOutput")
        .select("*")
        .in(
          "trackedEntityId",
          Array.from(
            new Set([
              trackedEntityId,
              ...(ancestors?.data?.map((ancestor) => ancestor.id) || []),
            ])
          )
        ),
    ]);

    const uniqueActivityIds = Array.from(
      new Set([
        ...(inputs?.data?.map((input) => input.trackedActivityId) || []),
        ...(outputs?.data?.map((output) => output.trackedActivityId) || []),
      ])
    );

    const activities = await client
      .from("trackedActivity")
      .select("*")
      .in("id", uniqueActivityIds);

    return json({
      entities: [
        ...(entity?.data ? [entity.data] : []),
        ...(descendants?.data ?? []),
        ...(ancestors?.data ?? []),
      ].reduce((acc, curr) => {
        if (!acc.some((item) => item.id === curr.id)) {
          acc.push(curr as TrackedEntity);
        }
        return acc;
      }, [] as TrackedEntity[]),
      inputs: inputs?.data ?? [],
      outputs: outputs?.data ?? [],
      activities: activities?.data ?? [],
    });
  }

  if (trackedActivityId) {
    // Get the initial activity and its direct inputs/outputs
    const [activity, directInputs, directOutputs] = await Promise.all([
      client.from("trackedActivity").select("*").eq("id", trackedActivityId),
      client
        .from("trackedActivityInput")
        .select("*")
        .eq("trackedActivityId", trackedActivityId),
      client
        .from("trackedActivityOutput")
        .select("*")
        .eq("trackedActivityId", trackedActivityId),
    ]);

    // Get the direct entities connected to this activity
    const directEntityIds = Array.from(
      new Set([
        ...(directInputs?.data?.map((input) => input.trackedEntityId) || []),
        ...(directOutputs?.data?.map((output) => output.trackedEntityId) || []),
      ])
    );

    // Get the direct entities
    const directEntities = await client
      .from("trackedEntity")
      .select("*")
      .in("id", directEntityIds);

    // Get additional activities connected to these entities
    const [additionalInputs, additionalOutputs] = await Promise.all([
      client
        .from("trackedActivityInput")
        .select("*")
        .in("trackedEntityId", directEntityIds)
        .neq("trackedActivityId", trackedActivityId),
      client
        .from("trackedActivityOutput")
        .select("*")
        .in("trackedEntityId", directEntityIds)
        .neq("trackedActivityId", trackedActivityId),
    ]);

    // Get additional activity IDs
    const additionalActivityIds = Array.from(
      new Set([
        ...(additionalInputs?.data?.map((input) => input.trackedActivityId) ||
          []),
        ...(additionalOutputs?.data?.map(
          (output) => output.trackedActivityId
        ) || []),
      ])
    );

    // Get additional activities
    const additionalActivities = await client
      .from("trackedActivity")
      .select("*")
      .in("id", additionalActivityIds);

    // Combine all inputs and outputs
    const allInputs = [
      ...(directInputs?.data || []),
      ...(additionalInputs?.data || []),
    ];

    const allOutputs = [
      ...(directOutputs?.data || []),
      ...(additionalOutputs?.data || []),
    ];

    // Combine all activities
    const allActivities = [
      ...(activity?.data || []),
      ...(additionalActivities?.data || []),
    ];

    return json({
      entities: directEntities?.data ?? [],
      inputs: allInputs,
      outputs: allOutputs,
      activities: allActivities,
    });
  }

  throw new Error("Invalid query parameters");
}
export default function TraceabilityRoute() {
  const [params, setParams] = useUrlParams();
  const selectedId =
    params.get("trackedEntityId") ?? params.get("trackedActivityId");

  const { entities, inputs, outputs, activities } =
    useLoaderData<typeof loader>();
  const [graphData, setGraphData] = useState<GraphData>({
    nodes: [],
    links: [],
  });

  const isEmpty = useMemo(() => {
    return entities.length === 0 && activities.length === 0;
  }, [entities, activities]);

  useEffect(() => {
    // Cast the data from the loader to the correct types
    const validEntities = entities.filter(
      Boolean
    ) as unknown as TrackedEntity[];
    const validActivities = activities.filter(Boolean) as unknown as Activity[];

    // Show all nodes and links
    const allNodes = getAllNodes(validEntities, validActivities);
    const allLinks = getAllLinks(inputs, outputs);
    setGraphData({ nodes: allNodes, links: allLinks });
  }, [entities, activities, inputs, outputs]);

  const handleNodeClick = (node: GraphNode) => {
    if (node.data.id === selectedId) {
      return;
    }

    if (node.type === "entity") {
      setParams({
        trackedEntityId: node.data.id,
        trackedActivityId: null,
      });
    } else {
      setParams({
        trackedEntityId: null,
        trackedActivityId: node.data.id,
      });
    }
  };

  const isHydrated = useHydrated();
  const navigation = useNavigation();

  return (
    <div className="flex bg-card h-[calc(100dvh-49px)] w-full overflow-hidden scrollbar-hide">
      <VStack className="flex-1 min-w-0 h-full">
        <HStack className="px-4 py-6 justify-between w-full relative">
          <HStack spacing={1}>
            <Heading size={"h2"}>Traceability</Heading>
          </HStack>
        </HStack>
        <div className="flex flex-1 w-full h-full overflow-y-auto scrollbar-hide p-4">
          <div className="w-full max-w-full overflow-x-auto text-muted-foreground">
            {isEmpty ? (
              <Empty className="h-full w-full">
                <Button asChild>
                  <Link to={path.to.traceability}>Back to traceability</Link>
                </Button>
              </Empty>
            ) : (
              <ParentSize>
                {({ width, height }) => (
                  <Loading
                    isLoading={!isHydrated || navigation.state !== "idle"}
                  >
                    <TraceabilityGraph
                      key={`graph-${selectedId}`}
                      data={graphData}
                      onNodeClick={handleNodeClick}
                      selectedId={selectedId}
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
          key={`sidebar-${selectedId}`}
          entity={
            entities
              .filter(Boolean)
              .find(
                (entity) => entity?.id === selectedId
              ) as TrackedEntity | null
          }
          activity={
            activities
              .filter(Boolean)
              .find(
                (activity) => activity?.id === selectedId
              ) as Activity | null
          }
        />
      )}
    </div>
  );
}

// Function to filter graph data based on selected node
export const filterGraphByNode = (
  allEntities: TrackedEntity[],
  allActivities: Activity[],
  allInputs: ActivityInput[],
  allOutputs: ActivityOutput[],
  selectedNode: GraphNode | null
): GraphData => {
  if (!selectedNode) {
    // Return empty graph if no node is selected
    return { nodes: [], links: [] };
  }

  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const nodeIds = new Set<string>();

  // Add the selected node with depth 0
  nodes.push({
    ...selectedNode,
    depth: 0,
    parentId: null,
  });
  nodeIds.add(selectedNode.id);

  if (selectedNode.type === "entity") {
    // For entity nodes, show direct parents (activities that output this entity)
    // and direct children (activities that use this entity as input)

    // Find activities that output this entity
    const parentActivities = allOutputs
      .filter((output) => output.trackedEntityId === selectedNode.id)
      .map((output) => {
        const activity = allActivities.find(
          (a) => a.id === output.trackedActivityId
        );
        if (activity && !nodeIds.has(activity.id)) {
          nodeIds.add(activity.id);
          return {
            id: activity.id,
            type: "activity" as const,
            data: activity,
            depth: -1, // Parent activities are at depth -1
            parentId: selectedNode.id,
          } as GraphNode;
        }
        return null;
      })
      .filter((node): node is NonNullable<typeof node> => node !== null);

    nodes.push(...parentActivities);

    // Add links from parent activities to this entity
    parentActivities.forEach((activity) => {
      if (activity) {
        links.push({
          source: activity.id,
          target: selectedNode.id,
          type: "output",
          quantity:
            allOutputs.find(
              (o) =>
                o.trackedActivityId === activity.id &&
                o.trackedEntityId === selectedNode.id
            )?.quantity || 1,
        });
      }
    });

    // Find activities that use this entity as input
    const childActivities = allInputs
      .filter((input) => input.trackedEntityId === selectedNode.id)
      .map((input) => {
        const activity = allActivities.find(
          (a) => a.id === input.trackedActivityId
        );
        if (activity && !nodeIds.has(activity.id)) {
          nodeIds.add(activity.id);
          return {
            id: activity.id,
            type: "activity" as const,
            data: activity,
            depth: 1, // Child activities are at depth 1
            parentId: selectedNode.id,
          } as GraphNode;
        }
        return null;
      })
      .filter((node): node is NonNullable<typeof node> => node !== null);

    nodes.push(...childActivities);

    // Add links from this entity to child activities
    childActivities.forEach((activity) => {
      if (activity) {
        links.push({
          source: selectedNode.id,
          target: activity.id,
          type: "input",
          quantity:
            allInputs.find(
              (i) =>
                i.trackedActivityId === activity.id &&
                i.trackedEntityId === selectedNode.id
            )?.quantity || 1,
        });
      }
    });
  } else if (selectedNode.type === "activity") {
    // For activity nodes, show all input entities and all output entities

    // Find all input entities for this activity
    const inputEntities = allInputs
      .filter((input) => input.trackedActivityId === selectedNode.id)
      .map((input) => {
        const entity = allEntities.find((e) => e.id === input.trackedEntityId);
        if (entity && !nodeIds.has(entity.id)) {
          nodeIds.add(entity.id);
          return {
            id: entity.id,
            type: "entity" as const,
            data: entity,
            depth: -1, // Input entities are at depth -1
            parentId: selectedNode.id,
          } as GraphNode;
        }
        return null;
      })
      .filter((node): node is NonNullable<typeof node> => node !== null);

    nodes.push(...inputEntities);

    // Add links from input entities to this activity
    inputEntities.forEach((entity) => {
      if (entity) {
        links.push({
          source: entity.id,
          target: selectedNode.id,
          type: "input",
          quantity:
            allInputs.find(
              (i) =>
                i.trackedActivityId === selectedNode.id &&
                i.trackedEntityId === entity.id
            )?.quantity || 1,
        });
      }
    });

    // Find all output entities for this activity
    const outputEntities = allOutputs
      .filter((output) => output.trackedActivityId === selectedNode.id)
      .map((output) => {
        const entity = allEntities.find((e) => e.id === output.trackedEntityId);
        if (entity && !nodeIds.has(entity.id)) {
          nodeIds.add(entity.id);
          return {
            id: entity.id,
            type: "entity" as const,
            data: entity,
            depth: 1, // Output entities are at depth 1
            parentId: selectedNode.id,
          } as GraphNode;
        }
        return null;
      })
      .filter((node): node is NonNullable<typeof node> => node !== null);

    nodes.push(...outputEntities);

    // Add links from this activity to output entities
    outputEntities.forEach((entity) => {
      if (entity) {
        links.push({
          source: selectedNode.id,
          target: entity.id,
          type: "output",
          quantity:
            allOutputs.find(
              (o) =>
                o.trackedActivityId === selectedNode.id &&
                o.trackedEntityId === entity.id
            )?.quantity || 1,
        });
      }
    });
  }

  return { nodes, links };
};

// Function to get all nodes for initial display
export const getAllNodes = (
  entities: TrackedEntity[],
  activities: Activity[]
): GraphNode[] => {
  const entityNodes: GraphNode[] = entities.map((entity) => ({
    id: entity.id,
    type: "entity",
    data: entity,
    depth: 0,
    parentId: null,
  }));

  const activityNodes: GraphNode[] = activities.map((activity) => ({
    id: activity.id,
    type: "activity",
    data: activity,
    depth: 0,
    parentId: null,
  }));

  return [...entityNodes, ...activityNodes];
};

// Function to get all links
export const getAllLinks = (
  inputs: ActivityInput[],
  outputs: ActivityOutput[]
): GraphLink[] => {
  const inputLinks: GraphLink[] = inputs.map((input) => ({
    source: input.trackedEntityId,
    target: input.trackedActivityId,
    type: "input",
    quantity: input.quantity,
  }));

  const outputLinks: GraphLink[] = outputs.map((output) => ({
    source: output.trackedActivityId,
    target: output.trackedEntityId,
    type: "output",
    quantity: output.quantity,
  }));

  return [...inputLinks, ...outputLinks];
};
