import { useCarbon } from "@carbon/auth";
import {
  Button,
  HStack,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useMount,
  VStack
} from "@carbon/react";
import type {
  TrackedActivityAttributes,
  TrackedEntityAttributes
} from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { LuCopy, LuLink } from "react-icons/lu";
import {
  CustomerAvatar,
  EmployeeAvatar,
  Hyperlink,
  SupplierAvatar
} from "~/components";
import { useWorkCenters } from "~/components/Form/WorkCenter";
import type { Activity, TrackedEntity } from "~/modules/inventory";
import { path } from "~/utils/path";
import { capitalize, copyToClipboard } from "~/utils/string";

export function TraceabilitySidebar({
  entity,
  activity
}: {
  entity: TrackedEntity | null;
  activity: Activity | null;
}) {
  const { t } = useLingui();
  const selectedNode = entity ?? activity;
  const selectedNodeType = entity ? "entity" : "activity";
  const selectedNodeAttributes = (
    entity ? (entity.attributes ?? {}) : (activity?.attributes ?? {})
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
                  aria-label={t`Link`}
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
                  aria-label={t`Copy`}
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
            <span className="text-sm tabular-nums">{entity?.quantity}</span>
          </VStack>
        )}

        {selectedNodeType === "entity" && entity?.readableId && (
          <VStack spacing={0}>
            <span className="text-xs text-muted-foreground">
              Serial/Batch #
            </span>
            <span className="text-sm">{entity.readableId}</span>
          </VStack>
        )}

        {Object.entries(selectedNodeAttributes)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([key, value]) => {
            if (key.startsWith("Operation ")) return null;
            switch (
              key as keyof (TrackedEntityAttributes & TrackedActivityAttributes)
            ) {
              case "Customer":
                return <CustomerAttribute key={key} value={value} />;
              case "Employee":
                return <EmployeeAttribute key={key} value={value} />;
              case "Inspector":
                return <InspectorAttribute key={key} value={value} />;
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
              default: {
                if (key === "expiryOverrides") return null;
                if (value === null || value === undefined) return null;
                if (typeof value === "object") {
                  return (
                    <VStack spacing={0} key={key}>
                      <span className="text-xs text-muted-foreground">
                        {key}
                      </span>
                      <span className="text-sm font-mono break-all">
                        {JSON.stringify(value)}
                      </span>
                    </VStack>
                  );
                }
                return (
                  <VStack spacing={0} key={key}>
                    <span className="text-xs text-muted-foreground">{key}</span>
                    <span className="text-sm">{String(value)}</span>
                  </VStack>
                );
              }
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

function InspectorAttribute({ value }: { value: string }) {
  return (
    <VStack spacing={1}>
      <span className="text-xs text-muted-foreground">Inspector</span>
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
  eventId
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
  operationId
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
  materialId
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
  purchaseOrderId
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
