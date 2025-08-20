import { useCarbon } from "@carbon/auth";
import {
  Button,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack,
  useMount,
} from "@carbon/react";
import type {
  TrackedActivityAttributes,
  TrackedEntityAttributes,
} from "@carbon/utils";
import * as d3 from "d3";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { LuCopy, LuLink } from "react-icons/lu";
import {
  CustomerAvatar,
  EmployeeAvatar,
  Hyperlink,
  SupplierAvatar,
} from "~/components";
import { useWorkCenters } from "~/components/Form/WorkCenter";
import type {
  Activity,
  GraphData,
  GraphLink,
  GraphNode,
  TrackedEntity,
} from "~/modules/inventory";
import { path } from "~/utils/path";
import { capitalize, copyToClipboard } from "~/utils/string";

export function TraceabilityGraph({
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
      .attr("stroke", (d) => (d.data.id === selectedId ? "#2DD4BF" : "none"))
      .attr("stroke-width", (d) => (d.data.id === selectedId ? 3 : 0))
      .attr("fill", (d) => (d.type === "entity" ? "#2563EB" : "#7C3AED")) // blue-600 for entities, rose-600 for activities
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

export function TraceabilitySidebar({
  entity,
  activity,
}: {
  entity: TrackedEntity | null;
  activity: Activity | null;
}) {
  const selectedNode = entity ?? activity;
  const selectedNodeType = entity ? "entity" : "activity";
  const selectedNodeAttributes = (
    entity ? entity.attributes ?? {} : activity?.attributes ?? {}
  ) as Record<string, any>;

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

            switch (
              key as keyof (TrackedEntityAttributes & TrackedActivityAttributes)
            ) {
              case "Customer":
                return <CustomerAttribute key={key} value={value} />;
              case "Employee":
                return <EmployeeAttribute key={key} value={value} />;
              case "Job":
                return <JobAttribute key={key} jobId={value} />;
              case "Job Material":
                return null;
              case "Job Make Method":
                return (
                  <JobMakeMethodAttribute
                    key={key}
                    jobId={selectedNodeAttributes["Job"]}
                    makeMethodId={value}
                    materialId={selectedNodeAttributes["Job Material"]}
                  />
                );
              case "Job Operation":
                return (
                  <JobOperationAttribute
                    key={key}
                    jobId={selectedNodeAttributes["Job"]}
                    operationId={value}
                  />
                );
              case "Purchase Order":
                return (
                  <PurchaseOrderAttribute key={key} purchaseOrderId={value} />
                );
              case "Purchase Order Line":
                return null;
              case "Receipt":
                return <ReceiptAttribute key={key} receiptId={value} />;
              case "Receipt Line":
                return null;
              case "Sales Order":
                return <SalesOrderAttribute key={key} salesOrderId={value} />;
              case "Sales Order Line":
                return null;
              case "Shipment":
                return <ShipmentAttribute key={key} shipmentId={value} />;
              case "Shipment Line":
                return null;
              case "Production Event":
                return (
                  <JobProductionEvent
                    key={key}
                    jobId={selectedNodeAttributes["Job"]}
                    eventId={value}
                  />
                );
              case "Supplier":
                return <SupplierAttribute key={key} value={value} />;
              case "Work Center":
                return <WorkCenterAttribute key={key} value={value} />;
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
            ? path.to.jobMakeMethod(jobId, makeMethodId)
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
