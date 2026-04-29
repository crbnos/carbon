import { useCarbon } from "@carbon/auth";
import { cn, useMount } from "@carbon/react";
import type {
  TrackedActivityAttributes,
  TrackedEntityAttributes
} from "@carbon/utils";
import { useState } from "react";
import { Link } from "react-router";
import { CustomerAvatar, EmployeeAvatar, SupplierAvatar } from "~/components";
import { useWorkCenters } from "~/components/Form/WorkCenter";
import { path } from "~/utils/path";

function InlineLink({
  to,
  children,
  className
}: {
  to: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      to={to}
      prefetch="intent"
      className={cn(
        "text-sm font-medium text-foreground hover:underline truncate",
        className
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </Link>
  );
}

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
    <dl className="divide-y divide-border/30">
      {Object.entries(attrs)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, value]) => {
          if (key.startsWith("Operation ")) return null;
          switch (
            key as keyof (TrackedEntityAttributes & TrackedActivityAttributes)
          ) {
            case "Customer":
              return (
                <Row key={key} label="Customer">
                  <CustomerAvatar customerId={value} />
                </Row>
              );
            case "Employee":
              return (
                <Row key={key} label="Employee">
                  <EmployeeAvatar employeeId={value} />
                </Row>
              );
            case "Inspector":
              return (
                <Row key={key} label="Inspector">
                  <EmployeeAvatar employeeId={value} />
                </Row>
              );
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
              return (
                <Row key={key} label="Supplier">
                  <SupplierAvatar supplierId={value} />
                </Row>
              );
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
                  <Row key={key} label={key}>
                    <span className="text-[11px] font-mono break-all">
                      {JSON.stringify(value)}
                    </span>
                  </Row>
                );
              }
              return (
                <Row key={key} label={key}>
                  <span className="text-sm truncate">{String(value)}</span>
                </Row>
              );
            }
          }
        })}
    </dl>
  );
}

function Row({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[8rem_1fr] items-center gap-3 py-1.5 first:pt-0 last:pb-0">
      <dt className="text-xs text-muted-foreground truncate">{label}</dt>
      <dd className="text-right min-w-0 truncate text-sm">{children}</dd>
    </div>
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
    <Row label="Job">
      <InlineLink to={path.to.jobDetails(jobId)}>{job ?? jobId}</InlineLink>
    </Row>
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
    <Row label="Production Event">
      {jobId && eventId ? (
        <InlineLink to={path.to.jobProductionEvent(jobId, eventId)}>
          {eventId}
        </InlineLink>
      ) : (
        <span className="text-sm text-muted-foreground">{eventId}</span>
      )}
    </Row>
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
    <Row label="Job Operation">
      {jobId && operationId ? (
        <InlineLink
          to={`${path.to.jobProductionEvents(
            jobId
          )}?filter=jobOperationId:eq:${operationId}`}
        >
          {operationId}
        </InlineLink>
      ) : (
        <span className="text-sm text-muted-foreground truncate">
          {operationId}
        </span>
      )}
    </Row>
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
    <Row label="Job Make Method">
      <InlineLink
        to={
          materialId
            ? path.to.jobMakeMethod(jobId, makeMethodId)
            : path.to.jobMethod(jobId, makeMethodId)
        }
      >
        {makeMethodId}
      </InlineLink>
    </Row>
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
    <Row label="Purchase Order">
      <InlineLink to={path.to.purchaseOrderDetails(purchaseOrderId)}>
        {poNumber ?? purchaseOrderId}
      </InlineLink>
    </Row>
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
    <Row label="Sales Order">
      <InlineLink to={path.to.salesOrderDetails(salesOrderId)}>
        {soNumber ?? salesOrderId}
      </InlineLink>
    </Row>
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
    <Row label="Receipt">
      <InlineLink to={path.to.receiptDetails(receiptId)}>
        {receiptNumber ?? receiptId}
      </InlineLink>
    </Row>
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
    <Row label="Shipment">
      <InlineLink to={path.to.shipmentDetails(shipmentId)}>
        {shipmentNumber ?? shipmentId}
      </InlineLink>
    </Row>
  );
}

function WorkCenterAttribute({ value }: { value: string }) {
  const workCenters = useWorkCenters({});
  const workCenter = workCenters.options.find((wc) => wc.value === value);
  return (
    <Row label="Work Center">
      <span className="text-sm truncate">{workCenter?.label ?? value}</span>
    </Row>
  );
}
