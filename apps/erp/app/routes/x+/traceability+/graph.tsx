import { useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Button,
  HStack,
  Heading,
  Loading,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack,
  useHydrated,
  useMount,
} from "@carbon/react";
import { useUrlParams } from "@carbon/remix";
import {
  TrackedActivityAttributes,
  TrackedEntityAttributes,
} from "@carbon/utils";
import { Link, useLoaderData, useNavigation } from "@remix-run/react";
import { json, LoaderFunctionArgs, redirect } from "@vercel/remix";
import { ParentSize } from "@visx/responsive";
import * as d3 from "d3";
import { motion } from "framer-motion";
import { useRef, useState, useEffect, useMemo } from "react";
import { LuLink, LuCopy } from "react-icons/lu";
import {
  CustomerAvatar,
  EmployeeAvatar,
  Empty,
  Hyperlink,
  SupplierAvatar,
} from "~/components";
import { useWorkCenters } from "~/components/Form/WorkCenter";
import {
  GraphData,
  GraphNode,
  GraphLink,
  TrackedEntity,
  ActivityInput,
  ActivityOutput,
  Activity,
} from "~/modules/inventory";
import { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { capitalize, copyToClipboard } from "~/utils/string";

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
      ],
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
                  <Link to={path.to.traceability}>
                    Back to traceability
                  </Link>
                </Button>
              </Empty>
            ): (
            <ParentSize>
              {({ width, height }) => (
                <Loading isLoading={!isHydrated || navigation.state !== "idle"}>
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
          .find((entity) => entity?.id === selectedId) as TrackedEntity | null
        }
        activity={
          activities
            .filter(Boolean)
            .find((activity) => activity?.id === selectedId) as Activity | null
        }
      />
    )}
    </div>
  );
}
function TraceabilitySidebar({
  entity,
  activity,
}: {
  entity: TrackedEntity | null;
  activity: Activity | null;
}) {
  const selectedNode = entity ?? activity;
  const selectedNodeType = entity ? "entity" : "activity";
  const selectedNodeAttributes = (entity
    ? (entity.attributes ?? {}) 
    : (activity?.attributes ?? {})) as Record<string, any>;

  return (
    <VStack
      spacing={4}
      className="w-96 flex-shrink-0 bg-sidebar h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-4 py-2 text-sm"
    >
      <VStack spacing={4}>
        <HStack className="w-full justify-between">
          <h3 className="text-xs text-muted-foreground">Attributes</h3>
          <HStack spacing={1}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="Link"
                  size="sm"
                  className="p-1"
                  onClick={() => copyToClipboard(window.location.href)}
                >
                  <LuLink className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy link</span>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label="Copy"
                  size="sm"
                  className="p-1"
                  onClick={() => copyToClipboard(selectedNode?.id ?? "")}
                >
                  <LuCopy className="w-3 h-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <span>Copy {capitalize(selectedNodeType)} ID</span>
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>
        <VStack spacing={0}>
          <span className="text-sm font-medium">
            {entity
              ? entity.sourceDocumentReadableId
              : activity
              ? activity.type
              : "No selection"}
          </span>
          <span className="text-xs text-muted-foreground">
            {selectedNode?.id}
          </span>
        </VStack>

        {selectedNodeType === "entity" && (
          <VStack spacing={0}>
            <span className="text-xs text-muted-foreground">Status</span>
            <span className="text-sm">{entity?.status}</span>
          </VStack>
        )}

        {selectedNodeType === "entity" && (
          <VStack spacing={0}>
            <span className="text-xs text-muted-foreground">Quantity</span>
            <span className="text-sm">{entity?.quantity}</span>
          </VStack>
        )}

        {Object.entries(selectedNodeAttributes)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([key, value]) => {
            if (key.startsWith("Operation ")) {
              return null;
            }
            console.log(key);
            switch (
              key as keyof (TrackedEntityAttributes & TrackedActivityAttributes)
            ) {
              case "Customer":
                return <CustomerAttribute value={value} />;
              case "Employee":
                return <EmployeeAttribute value={value} />;
              case "Job":
                return <JobAttribute jobId={value} />;
              case "Job Material":
                return null;
              case "Job Make Method":
                return (
                  <JobMakeMethodAttribute
                    jobId={selectedNodeAttributes["Job"]}
                    makeMethodId={value}
                    materialId={selectedNodeAttributes["Job Material"]}
                  />
                );
              case "Job Operation":
                return (
                  <JobOperationAttribute
                    jobId={selectedNodeAttributes["Job"]}
                    operationId={value}
                  />
                );
              case "Purchase Order":
                return <PurchaseOrderAttribute purchaseOrderId={value} />;
              case "Purchase Order Line":
                return null;
              case "Receipt":
                return <ReceiptAttribute receiptId={value} />;
              case "Receipt Line":
                return null;
              case "Sales Order":
                return <SalesOrderAttribute salesOrderId={value} />;
              case "Sales Order Line":
                return null;
              case "Shipment":
                return <ShipmentAttribute shipmentId={value} />;
              case "Shipment Line":
                return null;
              case "Production Event":
                return (
                  <JobProductionEvent
                    jobId={selectedNodeAttributes["Job"]}
                    eventId={value}
                  />
                );
              case "Supplier":
                return <SupplierAttribute value={value} />;
              case "Work Center":
                return <WorkCenterAttribute value={value} />;
              case "Consumed Quantity":
              case "Original Quantity":
              case "Remaining Quantity":
              case "Receipt Line Index":
              case "Shipment Line Index":
              // Special cases can be handled here in the future
              default:
                return (
                  <VStack spacing={0} key={key}>
                    <span className="text-xs text-muted-foreground">{key}</span>
                    <span className="text-sm">{value}</span>
                  </VStack>
                );
            }
          })}
      </VStack>
    </VStack>
  );
}

function CustomerAttribute({ value }: { value: string }) {
  return (
    <VStack spacing={1}>
      <span className="text-xs text-muted-foreground">Customer</span>
      <CustomerAvatar customerId={value} />
    </VStack>
  );
}

function EmployeeAttribute({ value }: { value: string }) {
  return (
    <VStack spacing={1}>
      <span className="text-xs text-muted-foreground">Employee</span>
      <EmployeeAvatar employeeId={value} />
    </VStack>
  );
}

function JobAttribute({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<string | null>(null);
  const { carbon } = useCarbon();

  const getJob = async () => {
    const response = await carbon
      ?.from("job")
      .select("jobId")
      .eq("id", jobId)
      .single();

    setJob(response?.data?.jobId ?? null);
  };

  useMount(() => {
    getJob();
  });

  return (
    <VStack spacing={1}>
      <span className="text-xs text-muted-foreground">Job</span>
      <Hyperlink to={path.to.jobDetails(jobId)}>{job ?? jobId}</Hyperlink>
    </VStack>
  );
}

function JobProductionEvent({
  jobId,
  eventId,
}: {
  jobId: string;
  eventId: string;
}) {
  return (
    <VStack spacing={1}>
      <span className="text-xs text-muted-foreground">Production Event</span>
      {jobId && eventId ? (
        <Hyperlink to={path.to.jobProductionEvent(jobId, eventId)}>
          {eventId}
        </Hyperlink>
      ) : (
        <span className="text-sm text-muted-foreground">{eventId}</span>
      )}
    </VStack>
  );
}

function JobOperationAttribute({
  jobId,
  operationId,
}: {
  jobId: string;
  operationId: string;
}) {
  return (
    <VStack spacing={1}>
      <span className="text-xs text-muted-foreground">Job Operation</span>
      {jobId && operationId ? (
        <Hyperlink
          to={`${path.to.jobProductionEvents(
            jobId
          )}?filter=jobOperationId:eq:${operationId}`}
        >
          {operationId}
        </Hyperlink>
      ) : (
        <span className="text-sm text-muted-foreground">{operationId}</span>
      )}
    </VStack>
  );
}

function JobMakeMethodAttribute({
  jobId,
  makeMethodId,
  materialId,
}: {
  jobId: string;
  makeMethodId: string;
  materialId: string;
}) {
  return (
    <VStack spacing={1}>
      <span className="text-xs text-muted-foreground">Job Make Method</span>
      <Hyperlink
        to={
          materialId
            ? path.to.jobMakeMethod(jobId, makeMethodId, materialId)
            : path.to.jobMethod(jobId, makeMethodId)
        }
      >
        {makeMethodId}
      </Hyperlink>
    </VStack>
  );
}

function PurchaseOrderAttribute({
  purchaseOrderId,
}: {
  purchaseOrderId: string;
}) {
  const [poNumber, setPoNumber] = useState<string | null>(null);
  const { carbon } = useCarbon();

  const getPurchaseOrder = async () => {
    const response = await carbon
      ?.from("purchaseOrder")
      .select("purchaseOrderId")
      .eq("id", purchaseOrderId)
      .single();

    setPoNumber(response?.data?.purchaseOrderId ?? null);
  };

  useMount(() => {
    getPurchaseOrder();
  });

  return (
    <VStack spacing={1}>
      <span className="text-xs text-muted-foreground">Purchase Order</span>
      <Hyperlink to={path.to.purchaseOrderDetails(purchaseOrderId)}>
        {poNumber ?? purchaseOrderId}
      </Hyperlink>
    </VStack>
  );
}

function SalesOrderAttribute({ salesOrderId }: { salesOrderId: string }) {
  const [soNumber, setSoNumber] = useState<string | null>(null);
  const { carbon } = useCarbon();

  const getSalesOrder = async () => {
    const response = await carbon
      ?.from("salesOrder")
      .select("salesOrderId")
      .eq("id", salesOrderId)
      .single();

    setSoNumber(response?.data?.salesOrderId ?? null);
  };

  useMount(() => {
    getSalesOrder();
  });

  return (
    <VStack spacing={1}>
      <span className="text-xs text-muted-foreground">Sales Order</span>
      <Hyperlink to={path.to.salesOrderDetails(salesOrderId)}>
        {soNumber ?? salesOrderId}
      </Hyperlink>
    </VStack>
  );
}

function ReceiptAttribute({ receiptId }: { receiptId: string }) {
  const [receiptNumber, setReceiptNumber] = useState<string | null>(null);
  const { carbon } = useCarbon();

  const getReceipt = async () => {
    const response = await carbon
      ?.from("receipt")
      .select("receiptId")
      .eq("id", receiptId)
      .single();

    setReceiptNumber(response?.data?.receiptId ?? null);
  };

  useMount(() => {
    getReceipt();
  });

  return (
    <VStack spacing={1}>
      <span className="text-xs text-muted-foreground">Receipt</span>
      <Hyperlink to={path.to.receiptDetails(receiptId)}>
        {receiptNumber ?? receiptId}
      </Hyperlink>
    </VStack>
  );
}
function ShipmentAttribute({ shipmentId }: { shipmentId: string }) {
  const [shipmentNumber, setShipmentNumber] = useState<string | null>(null);
  const { carbon } = useCarbon();

  const getShipment = async () => {
    const response = await carbon
      ?.from("shipment")
      .select("shipmentId")
      .eq("id", shipmentId)
      .single();

    setShipmentNumber(response?.data?.shipmentId ?? null);
  };

  useMount(() => {
    getShipment();
  });

  return (
    <VStack spacing={1}>
      <span className="text-xs text-muted-foreground">Shipment</span>
      <Hyperlink to={path.to.shipmentDetails(shipmentId)}>
        {shipmentNumber ?? shipmentId}
      </Hyperlink>
    </VStack>
  );
}

function SupplierAttribute({ value }: { value: string }) {
  return (
    <VStack spacing={1}>
      <span className="text-xs text-muted-foreground">Supplier</span>
      <SupplierAvatar supplierId={value} />
    </VStack>
  );
}

function WorkCenterAttribute({ value }: { value: string }) {
  const workCenters = useWorkCenters({});
  const workCenter = workCenters.options.find((wc) => wc.value === value);
  return (
    <VStack spacing={0}>
      <span className="text-xs text-muted-foreground">Work Center</span>
      <span className="text-sm">{workCenter?.label}</span>
    </VStack>
  );
}
type TraceabilityGraphProps = {
  data: GraphData;
  selectedId: string | null;
  onNodeClick: (node: GraphNode) => void;
  width: number;
  height: number;
};

function TraceabilityGraph({
  data,
  onNodeClick,
  width,
  height,
  selectedId,
}: TraceabilityGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || !data.nodes.length) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    // Add definitions for filters and markers
    const defs = svg.append("defs");

    // Arrow marker - increased size for bigger arrowheads
    defs
      .append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 -4 8 8") // Increased viewBox size
      .attr("refX", 24) // Adjusted refX to account for larger size
      .attr("refY", 0)
      .attr("markerWidth", 6) // Increased from 4 to 6
      .attr("markerHeight", 6) // Increased from 4 to 6
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-4L8,0L0,4") // Increased path size
      .attr("fill", "currentColor"); // Use text-foreground color

    // Calculate node depths and assign radial positions
    const calculateNodeDepths = () => {
      // Create a map to store node depths
      const nodeDepths = new Map<string, number>();
      const nodeParents = new Map<string, string>();

      // Find root nodes (typically activities without incoming links)
      const rootNodes = data.nodes.filter((node) => {
        return (
          node.type === "activity" &&
          !data.links.some((link) => link.target === node.id)
        );
      });

      // If no clear root nodes, use the first activity
      const startNodes =
        rootNodes.length > 0
          ? rootNodes
          : data.nodes.filter((node) => node.type === "activity").slice(0, 1);

      // Initialize queue with root nodes at depth 0
      const queue: [string, number, string | null][] = startNodes.map(
        (node) => [node.id, 0, null]
      );

      // BFS to assign depths
      while (queue.length > 0) {
        const [nodeId, depth, parentId] = queue.shift()!;

        // Skip if we've already processed this node with a shorter path
        if (nodeDepths.has(nodeId) && nodeDepths.get(nodeId)! <= depth) {
          continue;
        }

        // Assign depth and parent
        nodeDepths.set(nodeId, depth);
        if (parentId) nodeParents.set(nodeId, parentId);

        // Find all connected nodes
        const outgoingLinks = data.links.filter(
          (link) => link.source === nodeId
        );
        for (const link of outgoingLinks) {
          queue.push([link.target, depth + 1, nodeId]);
        }

        // Also consider incoming links for non-root nodes
        if (depth > 0) {
          const incomingLinks = data.links.filter(
            (link) => link.target === nodeId && link.source !== parentId
          );
          for (const link of incomingLinks) {
            queue.push([link.source, depth + 1, nodeId]);
          }
        }
      }

      return { nodeDepths, nodeParents };
    };

    const { nodeDepths, nodeParents } = calculateNodeDepths();

    // Enhance nodes with depth information
    data.nodes.forEach((node) => {
      node.depth = nodeDepths.get(node.id) || 0;
      node.parentId = nodeParents.get(node.id) || null;
    });

    // Create a force simulation with improved forces
    const simulation = d3
      .forceSimulation<d3.SimulationNodeDatum & GraphNode>(data.nodes as any)
      .force(
        "link",
        d3
          .forceLink<
            d3.SimulationNodeDatum & GraphNode,
            d3.SimulationLinkDatum<d3.SimulationNodeDatum & GraphNode> &
              GraphLink
          >(data.links as any)
          .id((d) => (d as any).id)
          .distance((d) => {
            // Increase distance based on the depth of connected nodes
            const sourceNode = data.nodes.find(
              (n) => n.id === (d as any).source.id
            );
            const targetNode = data.nodes.find(
              (n) => n.id === (d as any).target.id
            );
            if (sourceNode && targetNode) {
              const depthDiff = Math.abs(
                (sourceNode.depth || 0) - (targetNode.depth || 0)
              );
              return 150 + depthDiff * 50; // Base distance + additional for depth difference
            }
            return 150;
          })
      )
      .force("charge", d3.forceManyBody().strength(-800)) // Stronger repulsion
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force(
        "collision",
        d3.forceCollide().radius((d) => {
          // Larger collision radius for nodes with higher depth
          const node = d as GraphNode;
          return 60 + (node.depth || 0) * 5;
        })
      )
      .force("x", d3.forceX(width / 2).strength(0.1))
      .force(
        "y",
        d3
          .forceY()
          .y((d) => {
            // Position nodes vertically based on their level or type
            const node = d as GraphNode;
            if (node.type === "activity") {
              return height * 0.4; // Activities in the middle
            } else {
              // For entities, check if they're inputs or outputs
              const isInput = data.links.some(
                (link) => link.target === node.id
              );
              const isOutput = data.links.some(
                (link) => link.source === node.id
              );

              if (isInput && !isOutput) {
                return height * 0.2; // Inputs at the top
              } else if (isOutput && !isInput) {
                return height * 0.6; // Outputs at the bottom
              } else {
                return height * 0.4; // Both input and output in the middle
              }
            }
          })
          .strength(0.3)
      )
      // Add radial force to push nodes outward based on depth
      .force(
        "radial",
        d3
          .forceRadial<d3.SimulationNodeDatum & GraphNode>(
            (d) => {
              const node = d as GraphNode;
              // Radius increases with depth
              return 100 + (node.depth || 0) * 120;
            },
            width / 2,
            height / 2
          )
          .strength(0.8)
      );

    // Create curved links with uniform size
    const link = svg
      .append("g")
      .attr("class", "links")
      .selectAll("path")
      .data(data.links)
      .enter()
      .append("path")
      .attr("stroke-width", 1.5)
      .attr("stroke", "currentColor") // Use text-foreground color
      .attr("marker-end", "url(#arrow)")
      .attr("fill", "none")
      .style("opacity", 0.8); // Increased opacity for better visibility

    // Create the nodes group
    const node = svg
      .append("g")
      .attr("class", "nodes")
      .selectAll("g")
      .data(data.nodes)
      .enter()
      .append("g")
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on("start", dragstarted)
          .on("drag", dragged)
          .on("end", dragended) as any
      );

    // Add circles for the nodes with shadow and glow
    node
      .append("circle")
      .attr("r", (d) => 20 + (d.depth || 0) * 2) // Slightly larger circles for deeper nodes
      .attr("fill", (d) =>
        d.data.id === selectedId
          ? "#2DD4BF"
          : d.type === "entity"
          ? "#2563EB"
          : "#7C3AED"
      ) // blue-600 for entities, rose-600 for activities
      .attr("filter", "url(#drop-shadow)")
      .style("filter", "url(#glow)")
      .on("click", (event, d) => {
        event.stopPropagation();
        onNodeClick(d);
      });
    // Add labels to the nodes
    node
      .append("text")
      .text((d) => {
        if (d.type === "entity") {
          const entity = d.data as TrackedEntity;
          return entity.sourceDocumentReadableId || entity.id.substring(0, 8);
        } else {
          const activity = d.data as Activity;
          // Use optional chaining for properties that might not exist
          return activity.type || activity.id?.substring(0, 8) || "Unknown";
        }
      })
      .attr("text-anchor", "middle")
      .attr("dy", (d) => 30 + (d.depth || 0) * 2) // Adjust label position for larger circles
      .attr("font-size", "12px")
      .attr("fill", "hsl(var(--foreground))") // Use white in dark mode and black in light mode
      .attr("font-weight", "bold")
      .attr("font-family", "Geist");

    // Add serial number below the label
    node
      .append("text")
      .text((d) => d.id?.substring(0, 8) || "")
      .attr("text-anchor", "middle")
      .attr("dy", (d) => 45 + (d.depth || 0) * 2) // Position below the main label
      .attr("font-size", "10px")
      .attr("fill", "currentColor")
      .attr("font-family", "Geist");

    // Add title for hover tooltip
    node.append("title").text((d) => {
      if (d.type === "entity") {
        const entity = d.data as TrackedEntity;
        return `Entity: ${
          entity.sourceDocumentReadableId || entity.id
        }\nQuantity: ${entity.quantity}`;
      } else {
        const activity = d.data as Activity;
        return `Activity: ${activity.type || "Unknown"}\nID: ${
          activity.id || "Unknown"
        }`;
      }
    });

    // Update positions on each tick of the simulation
    simulation.on("tick", () => {
      // Keep nodes within bounds
      data.nodes.forEach((d: any) => {
        d.x = Math.max(30, Math.min(width - 30, d.x));
        d.y = Math.max(30, Math.min(height - 30, d.y));
      });

      // Update curved links
      link.attr("d", (d: any) => {
        const dx = d.target.x - d.source.x;
        const dy = d.target.y - d.source.y;
        const dr = Math.sqrt(dx * dx + dy * dy) * 1.5;
        return `M${d.source.x},${d.source.y}A${dr},${dr} 0 0,1 ${d.target.x},${d.target.y}`;
      });

      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });

    // Drag functions
    function dragstarted(event: d3.D3DragEvent<SVGGElement, GraphNode, any>) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    }

    function dragged(event: d3.D3DragEvent<SVGGElement, GraphNode, any>) {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }

    function dragended(event: d3.D3DragEvent<SVGGElement, GraphNode, any>) {
      if (!event.active) simulation.alphaTarget(0);
      // Don't reset fx and fy to null to keep nodes in place after dragging
      // This allows nodes to stay where they were dragged to
    }

    return () => {
      simulation.stop();
    };
  }, [data, width, height, onNodeClick, selectedId]);

  return (
    <motion.div
      className="relative"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <svg ref={svgRef} width={width} height={height} />
    </motion.div>
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
