import { useCarbon } from "@carbon/auth";
import {
  Badge,
  Button,
  cn,
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
import { useMemo, useState } from "react";
import { LuChevronRight, LuCopy, LuExternalLink, LuLink } from "react-icons/lu";
import { Link } from "react-router";
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
import { ACTIVITY_KIND_META, activityKindFor } from "./activityIcons";
import TrackedEntityStatus from "./TrackedEntityStatus";
import { type LineagePayload, sourceLinkHref } from "./utils";

type SidebarProps = {
  entity: TrackedEntity | null;
  activity: Activity | null;
  payload?: LineagePayload;
  onSelect?: (id: string) => void;
};

export function TraceabilitySidebar({
  entity,
  activity,
  payload,
  onSelect
}: SidebarProps) {
  const { t } = useLingui();
  const selectedNode = entity ?? activity;
  const selectedNodeType = entity ? "entity" : "activity";
  const selectedNodeAttributes = (
    entity ? (entity.attributes ?? {}) : (activity?.attributes ?? {})
  ) as Record<string, any>;

  const headline =
    entity?.sourceDocumentReadableId ??
    entity?.readableId ??
    activity?.type ??
    selectedNode?.id ??
    "No selection";

  const sourceDoc = entity?.sourceDocument ?? activity?.sourceDocument;
  const sourceDocId = entity?.sourceDocumentId ?? activity?.sourceDocumentId;
  const sourceDocReadableId =
    entity?.sourceDocumentReadableId ?? activity?.sourceDocumentReadableId;
  const sourceHref = sourceLinkHref(sourceDoc, sourceDocId);

  const { producedBy, consumedBy, inputs, outputs } = useMemo(() => {
    if (!payload) {
      return {
        producedBy: [] as RelatedActivity[],
        consumedBy: [] as RelatedActivity[],
        inputs: [] as RelatedEntity[],
        outputs: [] as RelatedEntity[]
      };
    }
    const activityById = new Map(payload.activities.map((a) => [a.id, a]));
    const entityById = new Map(payload.entities.map((e) => [e.id, e]));

    const producedBy: RelatedActivity[] = [];
    const consumedBy: RelatedActivity[] = [];
    const inputs: RelatedEntity[] = [];
    const outputs: RelatedEntity[] = [];

    if (entity) {
      for (const o of payload.outputs) {
        if (o.trackedEntityId !== entity.id) continue;
        const a = activityById.get(o.trackedActivityId);
        if (a) producedBy.push({ activity: a, quantity: o.quantity });
      }
      for (const i of payload.inputs) {
        if (i.trackedEntityId !== entity.id) continue;
        const a = activityById.get(i.trackedActivityId);
        if (a) consumedBy.push({ activity: a, quantity: i.quantity });
      }
    } else if (activity) {
      for (const i of payload.inputs) {
        if (i.trackedActivityId !== activity.id) continue;
        const e = entityById.get(i.trackedEntityId);
        if (e) inputs.push({ entity: e, quantity: i.quantity });
      }
      for (const o of payload.outputs) {
        if (o.trackedActivityId !== activity.id) continue;
        const e = entityById.get(o.trackedEntityId);
        if (e) outputs.push({ entity: e, quantity: o.quantity });
      }
    }

    return { producedBy, consumedBy, inputs, outputs };
  }, [payload, entity, activity]);

  return (
    <VStack
      spacing={4}
      className="w-96 flex-shrink-0 bg-sidebar h-full overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent border-l border-border px-5 py-5 text-sm"
    >
      <VStack spacing={3}>
        <HStack className="w-full justify-between items-start">
          <HStack spacing={2} className="items-center flex-wrap">
            {entity ? (
              <Badge
                variant="secondary"
                className="uppercase tracking-wide text-[10px]"
              >
                Entity
              </Badge>
            ) : activity ? (
              <>
                <Badge
                  variant="outline"
                  className="uppercase tracking-wide text-[10px]"
                >
                  Activity
                </Badge>
                <ActivityTypeChip type={activity.type} />
              </>
            ) : null}
          </HStack>
          <HStack spacing={1}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label={t`Copy link`}
                  size="sm"
                  className="p-1"
                  onClick={() => copyToClipboard(window.location.href)}
                >
                  <LuLink className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy link</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  aria-label={t`Copy ID`}
                  size="sm"
                  className="p-1"
                  onClick={() => copyToClipboard(selectedNode?.id ?? "")}
                >
                  <LuCopy className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Copy {capitalize(selectedNodeType)} ID
              </TooltipContent>
            </Tooltip>
          </HStack>
        </HStack>

        <VStack spacing={0}>
          <span className="text-base font-semibold leading-tight">
            {headline}
          </span>
          <span className="text-xs text-muted-foreground font-mono break-all mt-1">
            {selectedNode?.id}
          </span>
        </VStack>
      </VStack>

      {selectedNodeType === "entity" && (
        <VStack spacing={2}>
          <HStack className="w-full justify-between items-center min-h-[28px]">
            <span className="text-xs text-muted-foreground">Status</span>
            <TrackedEntityStatus status={entity?.status} />
          </HStack>
          <HStack className="w-full justify-between items-center min-h-[28px]">
            <span className="text-xs text-muted-foreground">Quantity</span>
            <span className="text-sm font-medium tabular-nums">
              {entity?.quantity}
            </span>
          </HStack>
          {entity?.readableId && (
            <HStack className="w-full justify-between items-center min-h-[28px]">
              <span className="text-xs text-muted-foreground">
                Serial / Batch
              </span>
              <span className="text-sm font-mono">{entity.readableId}</span>
            </HStack>
          )}
        </VStack>
      )}

      {sourceDoc && (
        <VStack spacing={2}>
          <SectionHeader>Source Document</SectionHeader>
          <SourceDocCard
            sourceDoc={sourceDoc}
            sourceDocId={sourceDocId ?? null}
            sourceDocReadableId={sourceDocReadableId ?? null}
            href={sourceHref}
          />
        </VStack>
      )}

      {producedBy.length > 0 && (
        <RelatedActivitySection
          title="Produced by"
          items={producedBy}
          onSelect={onSelect}
        />
      )}
      {consumedBy.length > 0 && (
        <RelatedActivitySection
          title="Consumed by"
          items={consumedBy}
          onSelect={onSelect}
        />
      )}
      {inputs.length > 0 && (
        <RelatedEntitySection
          title="Inputs"
          items={inputs}
          onSelect={onSelect}
        />
      )}
      {outputs.length > 0 && (
        <RelatedEntitySection
          title="Outputs"
          items={outputs}
          onSelect={onSelect}
        />
      )}

      {hasRenderedAttributes(selectedNodeAttributes) && (
        <VStack spacing={3}>
          <SectionHeader>Attributes</SectionHeader>
          <VStack spacing={3}>
            {Object.entries(selectedNodeAttributes)
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([key, value]) => {
                if (key.startsWith("Operation ")) return null;
                switch (
                  key as keyof (TrackedEntityAttributes &
                    TrackedActivityAttributes)
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
                      <PurchaseOrderAttribute
                        key={key}
                        purchaseOrderId={value}
                      />
                    );
                  case "Purchase Order Line":
                    return null;
                  case "Receipt":
                    return <ReceiptAttribute key={key} receiptId={value} />;
                  case "Receipt Line":
                    return null;
                  case "Sales Order":
                    return (
                      <SalesOrderAttribute key={key} salesOrderId={value} />
                    );
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
                        <span className="text-xs text-muted-foreground">
                          {key}
                        </span>
                        <span className="text-sm">{String(value)}</span>
                      </VStack>
                    );
                  }
                }
              })}
          </VStack>
        </VStack>
      )}
    </VStack>
  );
}

type RelatedActivity = { activity: Activity; quantity: number };
type RelatedEntity = { entity: TrackedEntity; quantity: number };

const SKIPPED_ATTRIBUTE_KEYS = new Set([
  "Job Material",
  "Purchase Order Line",
  "Receipt Line",
  "Sales Order Line",
  "Shipment Line",
  "expiryOverrides"
]);

function hasRenderedAttributes(attrs: Record<string, any>): boolean {
  for (const [key, value] of Object.entries(attrs)) {
    if (SKIPPED_ATTRIBUTE_KEYS.has(key)) continue;
    if (key.startsWith("Operation ")) continue;
    if (value === null || value === undefined) continue;
    return true;
  }
  return false;
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-[10px] uppercase tracking-wider text-muted-foreground font-semibold pb-1 border-b border-border/40">
      {children}
    </span>
  );
}

function ActivityTypeChip({ type }: { type: string | null | undefined }) {
  const kind = activityKindFor(type);
  const meta = ACTIVITY_KIND_META[kind];
  const Icon = meta.icon;
  return (
    <HStack spacing={2} className="items-center">
      <span
        className="w-4 h-4 rounded-sm flex items-center justify-center"
        style={{ background: meta.color }}
      >
        <Icon className="w-2.5 h-2.5 text-white" />
      </span>
      <span className="text-sm">{type ?? meta.label}</span>
    </HStack>
  );
}

function SourceDocCard({
  sourceDoc,
  sourceDocId,
  sourceDocReadableId,
  href
}: {
  sourceDoc: string;
  sourceDocId: string | null;
  sourceDocReadableId: string | null;
  href: string | null;
}) {
  const inner = (
    <HStack className="w-full items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm">
      <VStack spacing={0}>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {sourceDoc}
        </span>
        <span className="font-medium">
          {sourceDocReadableId ?? sourceDocId ?? "—"}
        </span>
      </VStack>
      {href && (
        <LuExternalLink className="w-4 h-4 text-muted-foreground shrink-0" />
      )}
    </HStack>
  );
  if (!href) return inner;
  return (
    <Link
      to={href}
      className="block hover:opacity-80 transition-opacity"
      onClick={(e) => e.stopPropagation()}
    >
      {inner}
    </Link>
  );
}

function RelatedActivitySection({
  title,
  items,
  onSelect
}: {
  title: string;
  items: RelatedActivity[];
  onSelect?: (id: string) => void;
}) {
  return (
    <VStack spacing={1}>
      <SectionHeader>{title}</SectionHeader>
      <VStack spacing={1}>
        {items.map((item) => {
          const kind = activityKindFor(item.activity.type);
          const meta = ACTIVITY_KIND_META[kind];
          const Icon = meta.icon;
          const label =
            item.activity.sourceDocumentReadableId ??
            item.activity.type ??
            item.activity.id.slice(0, 8);
          return (
            <button
              key={item.activity.id}
              type="button"
              onClick={() => onSelect?.(item.activity.id)}
              className={cn(
                "group w-full flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left",
                "border border-transparent bg-card hover:bg-accent/40 hover:border-border transition-colors"
              )}
            >
              <HStack spacing={2} className="items-center min-w-0">
                <span
                  className="w-4 h-4 rounded-sm flex items-center justify-center shrink-0"
                  style={{ background: meta.color }}
                >
                  <Icon className="w-2.5 h-2.5 text-white" />
                </span>
                <span className="text-sm truncate">{label}</span>
              </HStack>
              <HStack spacing={1} className="items-center shrink-0">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {item.quantity}
                </span>
                <LuChevronRight className="w-3 h-3 text-muted-foreground/60 group-hover:text-foreground transition-colors" />
              </HStack>
            </button>
          );
        })}
      </VStack>
    </VStack>
  );
}

function RelatedEntitySection({
  title,
  items,
  onSelect
}: {
  title: string;
  items: RelatedEntity[];
  onSelect?: (id: string) => void;
}) {
  return (
    <VStack spacing={1}>
      <SectionHeader>{title}</SectionHeader>
      <VStack spacing={1}>
        {items.map((item) => {
          const label =
            item.entity.sourceDocumentReadableId ??
            item.entity.readableId ??
            item.entity.id.slice(0, 8);
          return (
            <button
              key={item.entity.id}
              type="button"
              onClick={() => onSelect?.(item.entity.id)}
              className={cn(
                "group w-full flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left",
                "border border-transparent bg-card hover:bg-accent/40 hover:border-border transition-colors"
              )}
            >
              <HStack spacing={2} className="items-center min-w-0">
                <TrackedEntityStatus status={item.entity.status} />
                <span className="text-sm truncate">{label}</span>
              </HStack>
              <HStack spacing={1} className="items-center shrink-0">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {item.quantity}
                </span>
                <LuChevronRight className="w-3 h-3 text-muted-foreground/60 group-hover:text-foreground transition-colors" />
              </HStack>
            </button>
          );
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
