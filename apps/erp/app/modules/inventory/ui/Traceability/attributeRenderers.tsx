import { useCarbon } from "@carbon/auth";
import { useMount, VStack } from "@carbon/react";
import type {
  TrackedActivityAttributes,
  TrackedEntityAttributes
} from "@carbon/utils";
import { useState } from "react";
import {
  CustomerAvatar,
  EmployeeAvatar,
  Hyperlink,
  SupplierAvatar
} from "~/components";
import { useWorkCenters } from "~/components/Form/WorkCenter";
import { path } from "~/utils/path";

const SKIPPED_ATTRIBUTE_KEYS = new Set([
  "Job Material",
  "Purchase Order Line",
  "Receipt Line",
  "Sales Order Line",
  "Shipment Line",
  "expiryOverrides"
]);

export function hasRenderedAttributes(attrs: Record<string, any>): boolean {
  for (const [key, value] of Object.entries(attrs)) {
    if (SKIPPED_ATTRIBUTE_KEYS.has(key)) continue;
    if (key.startsWith("Operation ")) continue;
    if (value === null || value === undefined) continue;
    return true;
  }
  return false;
}

export function AttributeList({ attrs }: { attrs: Record<string, any> }) {
  return (
    <VStack spacing={3}>
      {Object.entries(attrs)
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
                  jobId={attrs.Job}
                  makeMethodId={value}
                  materialId={attrs["Job Material"]}
                />
              );
            case "Job Operation":
              return (
                <JobOperationAttribute
                  key={key}
                  jobId={attrs.Job}
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
                  jobId={attrs.Job}
                  eventId={value}
                />
              );
            case "Supplier":
              return <SupplierAttribute key={key} value={value} />;
            case "Work Center":
            case "WorkCenter" as any:
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
                    <span className="text-xs text-muted-foreground">{key}</span>
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
