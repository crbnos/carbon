// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { getLogger } from "@carbon/logger";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  HStack,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  VStack
} from "@carbon/react";
import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LuCirclePlay,
  LuClipboardCheck,
  LuClock,
  LuMapPin,
  LuPackage
} from "react-icons/lu";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { Link, useLoaderData } from "react-router";
import { DateTime } from "~/components";
import type { ColumnFilter } from "~/components/Filter";
import { ActiveFilters, Filter, useFilters } from "~/components/Filter";
import { MesAppBar, MesQueueHeader } from "~/components/MesAppBar";
import { MesEmptyState } from "~/components/MesEmptyState";
import { AssigneeTags } from "~/components/OperationCardParts";
import SearchFilter from "~/components/SearchFilter";
import { userContext } from "~/context";
import { useUrlParams } from "~/hooks";
import { getWorkCentersByCompany } from "~/services/operations.service";
import {
  getInspectionJobOperations,
  getInspectionReceiptLines,
  getOpenInspections
} from "~/services/quality.service";
import type { Handle } from "~/utils/handle";
import { pageMeta } from "~/utils/meta";
import { withOrigin } from "~/utils/origin";
import { path } from "~/utils/path";

export const handle: Handle = {
  realtime: ["inspection"]
};

const logger = getLogger("mes", "inspections");

export const meta: MetaFunction = () => pageMeta("Inspections");

function filterValues(filters: string[], key: string): string[] {
  for (const filter of filters) {
    const [filterKey, operator, value] = filter.split(":");
    if (filterKey !== key || !value) continue;
    if (operator === "in") return value.split(",");
    if (operator === "eq") return [value];
  }
  return [];
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {});
  const effectiveUserId = context.get(userContext)?.effectiveUserId ?? userId;
  const locationId = context.get(userContext)?.locationId;

  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.toLowerCase() ?? null;
  const filterParam = url.searchParams.getAll("filter").filter(Boolean);
  const selectedWorkCenterIds = filterValues(filterParam, "workCenterId");
  const selectedSources = filterValues(filterParam, "sourceDocument");

  // MES operators may not hold quality_view, so the queue reads as the system,
  // scoped to the company in every query.
  const serviceRole = getCarbonServiceRole();
  const [inspections, workCenters] = await Promise.all([
    getOpenInspections(serviceRole, companyId),
    getWorkCentersByCompany(serviceRole, companyId)
  ]);
  if (inspections.error) {
    logger.error("Failed to load open inspections", {
      companyId,
      error: inspections.error
    });
  }

  const lots = inspections.data ?? [];
  const lineIdsOf = (source: string) =>
    lots
      .filter(
        (lot) => lot.sourceDocument === source && lot.sourceDocumentLineId
      )
      .map((lot) => lot.sourceDocumentLineId as string);
  const [jobOperations, receiptLines] = await Promise.all([
    getInspectionJobOperations(
      serviceRole,
      companyId,
      lineIdsOf("Job Operation")
    ),
    getInspectionReceiptLines(serviceRole, companyId, lineIdsOf("Receipt"))
  ]);
  if (jobOperations.error) {
    logger.error("Failed to load inspection job operations", {
      companyId,
      error: jobOperations.error
    });
  }
  if (receiptLines.error) {
    logger.error("Failed to load inspection receipt lines", {
      companyId,
      error: receiptLines.error
    });
  }
  const operationById = new Map(
    (jobOperations.data ?? []).map((operation) => [operation.id, operation])
  );
  const receiptLineById = new Map(
    (receiptLines.data ?? []).map((line) => [line.id, line])
  );

  const companyWorkCenters = (workCenters.data ?? []).filter(
    (wc) => wc.id && wc.name
  );
  const workCenterName = new Map(
    companyWorkCenters.map((wc) => [wc.id as string, wc.name as string])
  );
  const workCenterLocation = new Map(
    companyWorkCenters.map((wc) => [wc.id as string, wc.locationId])
  );
  // The filter offers the work centers of the operator's location: the queue
  // shows no lot of another location's work center.
  const workCenterOptions = companyWorkCenters
    .filter((wc) => !locationId || wc.locationId === locationId)
    .map((wc) => ({ value: wc.id as string, label: wc.name as string }));

  // A Manual lot names its work center and assignee; a Job Operation lot
  // takes its operation's. A Receipt lot has neither, and is where its
  // receipt line is (else its receipt).
  const rows = lots.flatMap((lot) => {
    const operation =
      lot.sourceDocument === "Job Operation" && lot.sourceDocumentLineId
        ? operationById.get(lot.sourceDocumentLineId)
        : undefined;
    const receiptLine =
      lot.sourceDocument === "Receipt" && lot.sourceDocumentLineId
        ? receiptLineById.get(lot.sourceDocumentLineId)
        : undefined;
    const receipt = receiptLine?.receipt as {
      status: string;
      locationId: string | null;
    } | null;
    // A voided receipt's lot inspects stock that was never received.
    if (receipt?.status === "Voided") return [];

    const workCenterId =
      lot.sourceDocument === "Job Operation"
        ? (operation?.workCenterId ?? null)
        : (lot.workCenterId ?? null);
    const assignee =
      lot.sourceDocument === "Job Operation"
        ? (operation?.assignee ?? null)
        : (lot.assignee ?? null);

    // The operator sees the lots of their location. A lot with no location
    // to read (no work center, no receipt line) stays visible to everyone.
    const lotLocationId =
      lot.sourceDocument === "Receipt"
        ? (receiptLine?.locationId ?? receipt?.locationId ?? null)
        : workCenterId
          ? (workCenterLocation.get(workCenterId) ?? null)
          : null;
    if (locationId && lotLocationId && lotLocationId !== locationId) {
      return [];
    }

    return [
      {
        id: lot.id,
        inspectionId: lot.inspectionId,
        sourceDocument: lot.sourceDocument,
        sourceDocumentLineId: lot.sourceDocumentLineId,
        sourceDocumentReadableId: lot.sourceDocumentReadableId,
        itemReadableId: lot.itemReadableId,
        itemName: (lot.item as { name: string | null } | null)?.name ?? null,
        // The plan names what to check; pickers show name ?? fileName.
        planName: (() => {
          const plan = lot.inspectionDocument as {
            name: string | null;
            fileName: string | null;
          } | null;
          return plan?.name ?? plan?.fileName ?? null;
        })(),
        operationDescription: operation?.description ?? null,
        status: lot.status,
        lotSize: lot.lotSize,
        createdAt: lot.createdAt,
        workCenterId,
        workCenterName: workCenterId
          ? (workCenterName.get(workCenterId) ?? null)
          : null,
        assignee
      }
    ];
  });

  const filtered = rows.filter((row) => {
    if (
      selectedWorkCenterIds.length > 0 &&
      !selectedWorkCenterIds.includes(row.workCenterId ?? "")
    ) {
      return false;
    }
    if (
      selectedSources.length > 0 &&
      !selectedSources.includes(row.sourceDocument)
    ) {
      return false;
    }
    if (search) {
      return [
        row.inspectionId,
        row.itemReadableId,
        row.itemName,
        row.sourceDocumentReadableId
      ].some((value) => value?.toLowerCase().includes(search));
    }
    return true;
  });

  return {
    inspections: filtered,
    assignedInspections: filtered.filter(
      (row) => row.assignee === effectiveUserId
    ),
    workCenters: workCenterOptions
  };
}

type InspectionRow = Awaited<ReturnType<typeof loader>>["inspections"][number];

function InspectionCard({ inspection }: { inspection: InspectionRow }) {
  const { t } = useLingui();

  // The source is a filter, not a line: only a job's operation adds detail.
  const reference = [
    inspection.sourceDocumentReadableId,
    inspection.operationDescription
  ]
    .filter(Boolean)
    .join(" · ");

  const body = (
    <Card className="cursor-pointer p-0">
      <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
        <div className="flex min-w-0 flex-col space-y-0">
          <span className="line-clamp-1 font-mono text-xs text-muted-foreground">
            {inspection.inspectionId}
          </span>
          <span className="line-clamp-2 font-semibold leading-tight text-foreground">
            {inspection.itemName || inspection.itemReadableId}
          </span>
        </div>
        <Badge
          variant={inspection.status === "In Progress" ? "blue" : "secondary"}
          className="shrink-0"
        >
          {inspection.status === "In Progress" ? t`In Progress` : t`Pending`}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-left text-sm">
        {inspection.itemName && inspection.itemReadableId ? (
          <HStack className="justify-start space-x-2">
            <LuPackage className="text-muted-foreground" aria-hidden />
            <span className="line-clamp-1">{inspection.itemReadableId}</span>
          </HStack>
        ) : null}
        <HStack className="justify-start space-x-2">
          <LuClipboardCheck className="text-muted-foreground" aria-hidden />
          <span className="line-clamp-1">
            {inspection.planName ?? (
              <span className="text-muted-foreground">
                <Trans>No inspection plan</Trans>
              </span>
            )}
          </span>
        </HStack>
        {reference ? (
          <HStack className="justify-start space-x-2">
            <LuCirclePlay className="text-muted-foreground" aria-hidden />
            <span className="line-clamp-1">{reference}</span>
          </HStack>
        ) : null}
        <HStack className="justify-start space-x-2">
          <LuMapPin className="text-muted-foreground" aria-hidden />
          <span className="line-clamp-1">
            {inspection.workCenterName ?? (
              <span className="text-muted-foreground">
                <Trans>No work center</Trans>
              </span>
            )}
          </span>
        </HStack>
        <HStack className="justify-start space-x-2">
          <LuClock className="text-muted-foreground" aria-hidden />
          <span className="tabular-nums">
            <Trans>Lot</Trans> {inspection.lotSize} ·{" "}
            <DateTime value={inspection.createdAt} variant="relative" />
          </span>
        </HStack>
      </CardContent>
      {inspection.assignee ? (
        <CardFooter className="flex-wrap items-center justify-start text-xs">
          <AssigneeTags assignee={inspection.assignee} />
        </CardFooter>
      ) : null}
    </Card>
  );

  // A job-operation lot opens around its operation; a receipt or manual lot
  // opens on its own (its Reject still runs the ERP's write-off and NCR).
  const to =
    inspection.sourceDocument === "Job Operation" &&
    inspection.sourceDocumentLineId
      ? path.to.inspection(inspection.sourceDocumentLineId)
      : path.to.manualInspection(inspection.id);

  return <Link to={withOrigin(to, path.to.inspections)}>{body}</Link>;
}

function EmptyState({
  message,
  onClear
}: {
  message: string;
  onClear?: () => void;
}) {
  return (
    <MesEmptyState
      className="flex-1 w-full h-[calc(100dvh-var(--header-height)*2-40px-var(--announcement-height,0px))]"
      title={message}
      action={
        onClear ? (
          <Button onClick={onClear}>
            <Trans>Clear Search</Trans>
          </Button>
        ) : undefined
      }
    />
  );
}

export default function InspectionsRoute() {
  const { t } = useLingui();
  const { inspections, assignedInspections, workCenters } =
    useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState("all");
  // Phones: the tab row scrolls sideways; keep the active tab in view.
  const tabsListRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when the active tab changes
  useEffect(() => {
    tabsListRef.current
      ?.querySelector<HTMLElement>('[data-state="active"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTab]);
  const [params] = useUrlParams();
  const { hasFilters, clearFilters } = useFilters();
  const currentFilters = params.getAll("filter").filter(Boolean);

  const filters = useMemo<ColumnFilter[]>(
    () => [
      {
        accessorKey: "workCenterId",
        header: t`Work Center`,
        filter: { type: "static", options: workCenters }
      },
      {
        accessorKey: "sourceDocument",
        header: t`Source`,
        filter: {
          type: "static",
          options: [
            { label: t`Manual`, value: "Manual" },
            { label: t`Job Operation`, value: "Job Operation" },
            { label: t`Receipt`, value: "Receipt" }
          ]
        }
      }
    ],
    [workCenters, t]
  );

  const tabs = [
    {
      value: "all",
      label: t`All`,
      rows: inspections,
      empty: t`No open inspections`
    },
    {
      value: "assigned",
      label: t`Assigned to Me`,
      rows: assignedInspections,
      empty: t`No inspections assigned to you`
    }
  ];

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <MesAppBar title={<Trans>Inspections</Trans>} />
      <MesQueueHeader title={<Trans>Inspections</Trans>} />

      <div className="flex-1 min-h-0 w-full overflow-y-auto scrollbar-thin scrollbar-thumb-accent scrollbar-track-transparent">
        <div className="w-full p-4">
          <VStack spacing={4}>
            <div className="w-full">
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <HStack className="justify-between w-full max-md:flex-col max-md:items-stretch max-md:gap-2">
                  <TabsList
                    ref={tabsListRef}
                    className="max-md:-mx-4 max-md:w-[calc(100%+2rem)] max-md:justify-start max-md:overflow-x-auto max-md:px-4 scrollbar-hide max-md:scroll-fade-x"
                  >
                    {tabs.map((tab) => (
                      <TabsTrigger key={tab.value} value={tab.value}>
                        {tab.label}
                        {tab.rows.length > 0 && (
                          <Badge variant="secondary" className="ml-2">
                            {tab.rows.length}
                          </Badge>
                        )}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  <HStack spacing={2}>
                    <SearchFilter
                      param="search"
                      size="sm"
                      placeholder={t`Search`}
                    />
                    <Filter filters={filters} />
                  </HStack>
                </HStack>
                {currentFilters.length > 0 && (
                  <HStack className="py-1.5 justify-between w-full">
                    <ActiveFilters filters={filters} />
                  </HStack>
                )}
                {tabs.map((tab) => (
                  <TabsContent
                    key={tab.value}
                    value={tab.value}
                    className="mt-4"
                  >
                    {tab.rows.length > 0 ? (
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,330px),1fr))] gap-4">
                        {tab.rows.map((inspection) => (
                          <InspectionCard
                            key={inspection.id}
                            inspection={inspection}
                          />
                        ))}
                      </div>
                    ) : hasFilters ? (
                      <EmptyState
                        message={t`No results found`}
                        onClear={clearFilters}
                      />
                    ) : (
                      <EmptyState message={tab.empty} />
                    )}
                  </TabsContent>
                ))}
              </Tabs>
            </div>
          </VStack>
        </div>
      </div>
    </div>
  );
}
