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
  "Picking List Line",
  "Purchase Order Line",
  "Receipt Line",
  "Sales Order Line",
  "Shipment Line",
  "Inventory Adjustment",
  "expiryOverrides",
  // Injected by the lineage loader for the graph's edge badges; the stored
  // "From Shelf"/"To Shelf" ids already render as "From/To Storage Unit".
  "From Storage Unit Name",
  "To Storage Unit Name"
]);

// The edge functions still write "Shelf" keys into trackedActivity/trackedEntity
// attributes. Renaming them there would mean every historical row keeps the old
// key and every reader needs a fallback (post-picking reads "From Shelf" back to
// decide where to return stock), so the rename is display-only: stored key on the
// left, the storageUnit label users see on the right. `locationKey` names the
// sibling attribute holding the location, so the link can scope to it.
const STORAGE_UNIT_ATTRIBUTES: Record<
  string,
  { label: string; locationKey?: string }
> = {
  "From Shelf": { label: "From Storage Unit", locationKey: "From Location" },
  "To Shelf": { label: "To Storage Unit", locationKey: "To Location" },
  Shelf: { label: "Storage Unit" }
};

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
          const storageUnitAttribute = STORAGE_UNIT_ATTRIBUTES[key];
          if (storageUnitAttribute) {
            if (value === null || value === undefined) return null;
            return (
              <StorageUnitAttribute
                key={key}
                label={storageUnitAttribute.label}
                storageUnitId={value}
                locationId={
                  storageUnitAttribute.locationKey
                    ? attrs[storageUnitAttribute.locationKey]
                    : undefined
                }
              />
            );
          }
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
            case "Picking List":
              return <PickingListAttribute key={key} pickingListId={value} />;
            case "Picking List Line":
              return null;
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
            case "Stock Transfer":
              return (
                <StockTransferAttribute key={key} stockTransferId={value} />
              );
            case "Stock Transfer Line":
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
              if (SKIPPED_ATTRIBUTE_KEYS.has(key)) return null;
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
      <dd className="min-w-0 text-sm flex items-center justify-end gap-2 truncate">
        {children}
      </dd>
    </div>
  );
}

function PickingListAttribute({ pickingListId }: { pickingListId: string }) {
  const [readableId, setReadableId] = useState<string | null>(null);
  const { carbon } = useCarbon();

  const getPickingList = async () => {
    const response = await carbon
      ?.from("pickingList")
      .select("pickingListId")
      .eq("id", pickingListId)
      .single();
    setReadableId(response?.data?.pickingListId ?? null);
  };

  useMount(() => {
    getPickingList();
  });

  return (
    <Row label="Picking List">
      <InlineLink to={path.to.pickingList(pickingListId)}>
        {readableId ?? pickingListId}
      </InlineLink>
    </Row>
  );
}

function StockTransferAttribute({
  stockTransferId
}: {
  stockTransferId: string;
}) {
  const [readableId, setReadableId] = useState<string | null>(null);
  const { carbon } = useCarbon();

  const getStockTransfer = async () => {
    const response = await carbon
      ?.from("stockTransfer")
      .select("stockTransferId")
      .eq("id", stockTransferId)
      .single();
    setReadableId(response?.data?.stockTransferId ?? null);
  };

  useMount(() => {
    getStockTransfer();
  });

  return (
    <Row label="Stock Transfer">
      <InlineLink to={path.to.stockTransfer(stockTransferId)}>
        {readableId ?? stockTransferId}
      </InlineLink>
    </Row>
  );
}

function StorageUnitAttribute({
  label,
  storageUnitId,
  locationId
}: {
  label: string;
  storageUnitId: string;
  locationId?: string;
}) {
  const [name, setName] = useState<string | null>(null);
  const { carbon } = useCarbon();

  const getStorageUnit = async () => {
    const response = await carbon
      ?.from("storageUnit")
      .select("name")
      .eq("id", storageUnitId)
      .single();
    setName(response?.data?.name ?? null);
  };

  useMount(() => {
    getStorageUnit();
  });

  // Deep-link to the quantities screen pre-filtered to this bin. The filter
  // param shape is the shared table's: `<accessorKey>:<operator>:<value>`, and
  // storageUnitIds is an array column so it uses `contains`.
  const params = new URLSearchParams();
  if (locationId) params.set("location", locationId);
  params.append("filter", `storageUnitIds:contains:${storageUnitId}`);

  return (
    <Row label={label}>
      <InlineLink to={`${path.to.inventory}?${params.toString()}`}>
        {name ?? storageUnitId}
      </InlineLink>
    </Row>
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
