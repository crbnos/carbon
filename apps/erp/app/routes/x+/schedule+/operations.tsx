import { useCarbon } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import {
  Button,
  ClientOnly,
  Combobox,
  HStack,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
  Spinner,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
  useInterval,
  useLocalStorage,
  useMount,
  useRealtimeChannel,
  VStack
} from "@carbon/react";
import {
  getLocalTimeZone,
  now,
  parseAbsolute,
  toZoned
} from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LuCirclePlus,
  LuInfo,
  LuSettings2,
  LuTriangleAlert
} from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { SearchFilter } from "~/components";
import { Enumerable } from "~/components/Enumerable";
import { useLocations } from "~/components/Form/Location";
import { ActiveFilters, Filter } from "~/components/Table/components/Filter";
import type { ColumnFilter } from "~/components/Table/components/Filter/types";
import { useFilters } from "~/components/Table/components/Filter/useFilters";
import { useUrlParams, useUser } from "~/hooks";
import { getActiveJobOperationsByLocation } from "~/modules/production";
import type { Column, OperationItem } from "~/modules/production/ui/Schedule";
import type {
  BatchItem,
  DisplaySettings,
  Event,
  Item,
  Progress
} from "~/modules/production/ui/Schedule/Kanban";
import { isBatchItem, Kanban } from "~/modules/production/ui/Schedule/Kanban";
import { BatchOpportunityBanner } from "~/modules/production/ui/Schedule/Kanban/components/BatchOpportunityBanner";
import { BatchSelectionBar } from "~/modules/production/ui/Schedule/Kanban/components/BatchSelectionBar";
import { BatchSelectionProvider } from "~/modules/production/ui/Schedule/Kanban/context/BatchSelectionContext";
import { comparePriorityThenId } from "~/modules/production/ui/Schedule/Kanban/placement";
import { ScheduleNavigation } from "~/modules/production/ui/Schedule/Kanban/ScheuleNavigation";
import {
  getProcessesList,
  getWorkCentersByLocation
} from "~/modules/resources";
import { getTagsList } from "~/modules/shared";
import { resolveLocationId } from "~/modules/shared/location.server";
import { getDatabaseClient } from "~/services/database.server";
import { usePeople } from "~/stores";
import { makeDurations } from "~/utils/duration";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Schedule`,
  to: path.to.scheduleOperation,
  module: "schedule"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "production",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const filterParam = searchParams.getAll("filter");

  let selectedWorkCenterIds: string[] = [];
  let selectedProcessIds: string[] = [];
  let selectedSalesOrderIds: string[] = [];
  let selectedTags: string[] = [];
  let selectedAssignee: string[] = [];
  // Material-property facets (nesting compatibility): an operation matches if
  // ANY of its BOM lines matches ALL active facets.
  const selectedMaterialFacets: Record<string, string[]> = {};
  const MATERIAL_FACET_KEYS = [
    "substanceId",
    "gradeId",
    "dimensionId",
    "formId",
    "finishId"
  ] as const;

  if (filterParam) {
    for (const filter of filterParam) {
      const [key, operator, value] = filter.split(":");
      if (
        (MATERIAL_FACET_KEYS as readonly string[]).includes(key) &&
        (operator === "in" || operator === "eq")
      ) {
        selectedMaterialFacets[key] =
          operator === "in" ? value.split(",") : [value];
      }
      if (key === "workCenterId") {
        if (operator === "in") {
          selectedWorkCenterIds = value.split(",");
        } else if (operator === "eq") {
          selectedWorkCenterIds = [value];
        }
      } else if (key === "processId") {
        if (operator === "in") {
          selectedProcessIds = value.split(",");
        } else if (operator === "eq") {
          selectedProcessIds = [value];
        }
      } else if (key === "salesOrderId") {
        if (operator === "in") {
          selectedSalesOrderIds = value.split(",");
        } else if (operator === "eq") {
          selectedSalesOrderIds = [value];
        }
      } else if (key === "tag") {
        if (operator === "in") {
          selectedTags = value.split(",");
        } else if (operator === "eq") {
          selectedTags = [value];
        }
      } else if (key === "assignee") {
        if (operator === "in") {
          selectedAssignee = value.split(",");
        } else if (operator === "eq") {
          selectedAssignee = [value];
        }
      }
    }
  }

  const locationId = await resolveLocationId(client, request, {
    searchParams,
    userId,
    companyId,
    onDefaultsError: path.to.inventory,
    onNoLocations: path.to.inventory
  });

  const [workCenters, processes, operations, tags] = await Promise.all([
    getWorkCentersByLocation(client, locationId),
    getProcessesList(client, companyId),
    getActiveJobOperationsByLocation(client, locationId, selectedWorkCenterIds),
    getTagsList(client, companyId, "operation")
  ]);

  const processNameById = new Map(
    (processes.data ?? []).map((p) => [p.id, p.name])
  );

  // BOM material properties for every listed operation — powers the material
  // facets and the per-card chips. One Kysely join (id lists this size blow
  // the PostgREST URL limit).
  const opIds = (operations.data ?? []).map((op) => op.id);
  type MaterialLine = {
    substanceId: string | null;
    gradeId: string | null;
    dimensionId: string | null;
    formId: string | null;
    finishId: string | null;
    chip: string;
  };
  const materialLinesByOp = new Map<string, MaterialLine[]>();
  const facetOptions: Record<string, Map<string, string>> = {
    substanceId: new Map(),
    gradeId: new Map(),
    dimensionId: new Map(),
    formId: new Map(),
    finishId: new Map()
  };
  if (opIds.length > 0) {
    const db = getDatabaseClient();
    const materialRows = await db
      .selectFrom("jobMaterial as jm")
      .innerJoin("item as i", "i.id", "jm.itemId")
      .leftJoin("material as m", (join) =>
        join
          .onRef("m.id", "=", "i.readableId")
          .onRef("m.companyId", "=", "i.companyId")
      )
      .leftJoin("materialSubstance as ms", "ms.id", "m.materialSubstanceId")
      .leftJoin("materialGrade as mg", "mg.id", "m.gradeId")
      .leftJoin("materialDimension as md", "md.id", "m.dimensionId")
      .leftJoin("materialForm as mf", "mf.id", "m.materialFormId")
      .leftJoin("materialFinish as mfin", "mfin.id", "m.finishId")
      .select([
        "jm.jobOperationId",
        "m.materialSubstanceId as substanceId",
        "ms.name as substanceName",
        "m.gradeId",
        "mg.name as gradeName",
        "m.dimensionId",
        "md.name as dimensionName",
        "m.materialFormId as formId",
        "mf.name as formName",
        "m.finishId",
        "mfin.name as finishName"
      ])
      .where("jm.jobOperationId", "in", opIds)
      .where("jm.companyId", "=", companyId)
      .execute();

    for (const row of materialRows) {
      if (!row.jobOperationId) continue;
      const chip = [
        row.substanceName,
        row.gradeName,
        row.dimensionName,
        row.formName,
        row.finishName
      ]
        .filter(Boolean)
        .join(" ");
      if (!chip) continue;
      const line: MaterialLine = {
        substanceId: row.substanceId,
        gradeId: row.gradeId,
        dimensionId: row.dimensionId,
        formId: row.formId,
        finishId: row.finishId,
        chip
      };
      const lines = materialLinesByOp.get(row.jobOperationId);
      if (lines) lines.push(line);
      else materialLinesByOp.set(row.jobOperationId, [line]);

      if (row.substanceId && row.substanceName)
        facetOptions.substanceId.set(row.substanceId, row.substanceName);
      if (row.gradeId && row.gradeName)
        facetOptions.gradeId.set(row.gradeId, row.gradeName);
      if (row.dimensionId && row.dimensionName)
        facetOptions.dimensionId.set(row.dimensionId, row.dimensionName);
      if (row.formId && row.formName)
        facetOptions.formId.set(row.formId, row.formName);
      if (row.finishId && row.finishName)
        facetOptions.finishId.set(row.finishId, row.finishName);
    }
  }

  // Batch headers for collapsed cards (status + authoritative work center).
  const batchIds = [
    ...new Set(
      (operations.data ?? [])
        .map((op) => op.jobOperationBatchId)
        .filter((id): id is string => Boolean(id))
    )
  ];
  const batchHeaders =
    batchIds.length > 0
      ? await client
          .from("jobOperationBatch")
          .select("id, readableId, status, workCenterId")
          .in("id", batchIds)
          .eq("companyId", companyId)
      : { data: [] as never[], error: null };
  const batchById = new Map((batchHeaders.data ?? []).map((b) => [b.id, b]));

  const activeWorkCenters = new Set();

  operations.data?.forEach((op) => {
    if (op.operationStatus === "In Progress") {
      activeWorkCenters.add(op.workCenterId);
    }
  });

  let filteredOperations = selectedWorkCenterIds.length
    ? (operations.data?.filter((op) =>
        selectedWorkCenterIds.includes(op.workCenterId)
      ) ?? [])
    : (operations.data ?? []);

  if (selectedSalesOrderIds.length) {
    filteredOperations = filteredOperations.filter((op) =>
      selectedSalesOrderIds.includes(op.salesOrderId)
    );
  }

  if (selectedProcessIds.length) {
    filteredOperations = filteredOperations.filter((op) =>
      selectedProcessIds.includes(op.processId)
    );
  }

  if (selectedTags.length) {
    filteredOperations = filteredOperations.filter((op) => {
      if (op.tags) {
        return selectedTags.some((tag) => op.tags.includes(tag));
      }
      return false;
    });
  }

  if (selectedAssignee.length) {
    filteredOperations = filteredOperations.filter((op) =>
      selectedAssignee.includes(op.assignee)
    );
  }

  if (Object.keys(selectedMaterialFacets).length > 0) {
    filteredOperations = filteredOperations.filter((op) => {
      const lines = materialLinesByOp.get(op.id) ?? [];
      return lines.some((line) =>
        Object.entries(selectedMaterialFacets).every(([key, values]) => {
          const id = line[key as keyof MaterialLine];
          return typeof id === "string" && values.includes(id);
        })
      );
    });
  }

  if (search) {
    filteredOperations = filteredOperations.filter(
      (op) =>
        op.jobReadableId.toLowerCase().includes(search.toLowerCase()) ||
        op.itemReadableId.toLowerCase().includes(search.toLowerCase()) ||
        op.customerName?.toLowerCase().includes(search.toLowerCase()) ||
        op.description?.toLowerCase().includes(search.toLowerCase())
    );
  }

  const filteredWorkCenters =
    workCenters.data?.filter((wc: any) => {
      if (selectedWorkCenterIds.length && selectedProcessIds.length) {
        return (
          selectedWorkCenterIds.includes(wc.id!) &&
          wc.processes?.some((p: string) => selectedProcessIds.includes(p))
        );
      } else if (selectedWorkCenterIds.length) {
        return selectedWorkCenterIds.includes(wc.id!);
      } else if (selectedProcessIds.length) {
        return wc.processes?.some((p: string) =>
          selectedProcessIds.includes(p)
        );
      }
      return true;
    }) ?? [];

  // Map EVERY op (not just the filtered ones) so a batch card can render its
  // full membership. Member-level filters (material / tags / assignee / sales
  // order) can match only some of a batch's members; collapsing from the
  // filtered subset would misreport the member count, `priority` (min over the
  // subset), and aggregated chips while the card still reassigns/dissolves the
  // whole batch. So filtering decides which batches APPEAR; the members always
  // come from the full set.
  const allOperationItems = ((operations.data ?? []).map((op) => {
    const operation = makeDurations(op);
    return {
      id: op.id,
      columnId: op.workCenterId,
      columnType: op.processId,
      priority: op.priority,
      title: op.jobReadableId,
      link: op.parentMaterialId
        ? path.to.jobMakeMethod(op.jobId, op.jobMakeMethodId)
        : path.to.jobMethod(op.jobId, op.jobMakeMethodId),
      subtitle: op.itemReadableId,
      assignee: op.assignee,
      tags: op.tags,
      description: op.description,
      dueDate: op.operationDueDate,
      duration:
        operation.setupDuration +
        operation.laborDuration +
        operation.machineDuration,
      jobId: op.jobId,
      jobReadableId: op.jobReadableId,
      itemReadableId: op.itemReadableId,
      itemDescription: op.itemDescription,
      progress: 0,
      deadlineType: op.jobDeadlineType,
      customerId: op.jobCustomerId,
      targetQuantity: op.targetQuantity,
      quantity: op.operationQuantity,
      quantityCompleted: op.quantityComplete,
      quantityReworked: op.quantityReworked,
      quantityScrapped: op.quantityScrapped,
      reworkId: op.reworkId,
      salesOrderReadableId: op.salesOrderReadableId,
      salesOrderId: op.salesOrderId,
      salesOrderLineId: op.salesOrderLineId,
      status: op.operationStatus,
      setupDuration: operation.setupDuration,
      laborDuration: operation.laborDuration,
      machineDuration: operation.machineDuration,
      thumbnailPath: op.thumbnailPath,
      processBatchable: op.processBatchable,
      processName: processNameById.get(op.processId),
      jobOperationBatchId: op.jobOperationBatchId,
      batchReadableId: op.batchReadableId,
      materialChips: [
        ...new Set(
          (materialLinesByOp.get(op.id) ?? []).map((line) => line.chip)
        )
      ]
    };
  }) ?? []) satisfies OperationItem[];

  const filteredIds = new Set(filteredOperations.map((op) => op.id));

  const isLiveBatch = (item: OperationItem) => {
    const batch = item.jobOperationBatchId
      ? batchById.get(item.jobOperationBatchId)
      : undefined;
    return batch && (batch.status === "Active" || batch.status === "Completing")
      ? batch
      : undefined;
  };

  // Full membership per live (Active/Completing) batch, from the UNFILTERED set.
  const membersByBatch = new Map<string, OperationItem[]>();
  for (const item of allOperationItems) {
    const batch = isLiveBatch(item);
    if (!batch) continue;
    const members = membersByBatch.get(batch.id);
    if (members) members.push(item);
    else membersByBatch.set(batch.id, [item]);
  }

  // A batch card appears when at least one member survives filtering; it then
  // renders ALL its members. Non-batch ops render individually when filtered in;
  // an op whose batch header is missing/terminal is treated as unbatched.
  const survivingBatchIds = new Set<string>();
  const unbatchedItems: OperationItem[] = [];
  for (const item of allOperationItems) {
    if (!filteredIds.has(item.id)) continue;
    const batch = isLiveBatch(item);
    if (batch) {
      survivingBatchIds.add(batch.id);
    } else {
      unbatchedItems.push(
        item.jobOperationBatchId
          ? { ...item, jobOperationBatchId: null, batchReadableId: null }
          : item
      );
    }
  }

  const batchItems: BatchItem[] = [...survivingBatchIds].flatMap((batchId) => {
    const batch = batchById.get(batchId);
    const members = membersByBatch.get(batchId) ?? [];
    if (!batch || members.length === 0) return [];
    return [
      {
        id: `batch:${batchId}`,
        batchId,
        batchReadableId: batch.readableId,
        batchStatus: batch.status as BatchItem["batchStatus"],
        columnId: batch.workCenterId ?? members[0].columnId,
        columnType: members[0].columnType,
        priority: Math.min(...members.map((m) => m.priority)),
        title: batch.readableId,
        members
      } satisfies BatchItem
    ];
  });

  return {
    columns: filteredWorkCenters
      .map((wc) => ({
        id: wc.id!,
        title: wc.name!,
        type: wc.processes ?? [],
        active: activeWorkCenters.has(wc.id),
        isBlocked: wc.isBlocked ?? false,
        blockingDispatchId: wc.blockingDispatchId ?? undefined,
        blockingDispatchReadableId: wc.blockingDispatchReadableId ?? undefined
      }))
      .sort((a, b) => a.title.localeCompare(b.title)) satisfies Column[],
    items: [...unbatchedItems, ...batchItems] satisfies Item[],
    materialFacetOptions: Object.fromEntries(
      Object.entries(facetOptions).map(([key, map]) => [
        key,
        [...map.entries()].map(([id, name]) => ({ id, name }))
      ])
    ),
    processes: processes.data ?? [],
    salesOrders: Object.entries(
      filteredOperations?.reduce(
        (acc, op) => {
          if (op.salesOrderId) {
            acc[op.salesOrderId] = op.salesOrderReadableId;
          }
          return acc;
        },
        {} as Record<string, string>
      ) ?? {}
    ).map(([id, readableId]) => ({ id, readableId })),
    availableTags: Object.entries(
      filteredOperations.reduce(
        (acc, op) => {
          if (op.tags) {
            // biome-ignore lint/suspicious/useIterableCallbackReturn: suppressed due to migration
            op.tags.forEach((tag) => (acc[tag] = true));
          }
          return acc;
        },
        {} as Record<string, boolean>
      )
    ).map(([tag]) => tag),
    tags: tags.data ?? [],
    locationId
  };
}

type ScheduleDisplaySettings = DisplaySettings & {
  emptyWorkCenters: boolean;
};

const defaultDisplaySettings: ScheduleDisplaySettings = {
  emptyWorkCenters: true,
  showDuration: true,
  showCustomer: true,
  showDescription: true,
  showDueDate: true,
  showEmployee: true,
  showMaterial: true,
  showProgress: true,
  showQuantity: true,
  showStatus: true,
  showSalesOrder: true,
  showThumbnail: true
};

const DISPLAY_SETTINGS_KEY = "kanban-schedule-display-settings";
function KanbanSchedule() {
  const { t } = useLingui();
  const {
    columns,
    items: initialItems,
    materialFacetOptions,
    processes,
    salesOrders,
    availableTags,
    tags,
    locationId
  } = useLoaderData<typeof loader>();

  const locations = useLocations();

  const [items, setItems] = useState<Item[]>(initialItems);
  const [displaySettings, setDisplaySettings] = useLocalStorage(
    DISPLAY_SETTINGS_KEY,
    defaultDisplaySettings
  );
  const mergedDisplaySettings = useMemo(
    () => ({ ...defaultDisplaySettings, ...displaySettings }),
    [displaySettings]
  );

  useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  const sortItems = useCallback((items: Item[]) => {
    return [...items].sort(comparePriorityThenId);
  }, []);

  useEffect(() => {
    setItems((prevItems) => sortItems(prevItems));
  }, [sortItems]);

  const visibleColumns = useMemo(() => {
    if (mergedDisplaySettings.emptyWorkCenters) {
      return columns;
    }

    const workCenterIdsWithOperations = new Set(
      items.map((item) => item.columnId)
    );
    return columns.filter((column) =>
      workCenterIdsWithOperations.has(column.id)
    );
  }, [columns, items, mergedDisplaySettings.emptyWorkCenters]);

  const { progressByOperation } = useProgressByOperation(
    items,
    setItems,
    sortItems
  );

  const [people] = usePeople();
  const [params] = useUrlParams();

  const { hasFilters, clearFilters } = useFilters();
  const currentFilters = params.getAll("filter").filter(Boolean);
  const filters = useMemo<ColumnFilter[]>(() => {
    return [
      {
        accessorKey: "workCenterId",
        header: "Work Center",
        filter: {
          type: "static",
          options: columns.map((col) => ({
            label: <Enumerable value={col.title} />,
            value: col.id
          }))
        }
      },
      {
        accessorKey: "processId",
        header: "Process",
        pluralHeader: "Processes",
        filter: {
          type: "static",
          options: processes.map((p) => ({
            label: <Enumerable value={p.name} />,
            value: p.id
          }))
        }
      },
      {
        accessorKey: "salesOrderId",
        header: "Sales Order",
        filter: {
          type: "static",
          options: salesOrders.map((so) => ({
            label: so.readableId,
            value: so.id
          }))
        }
      },
      {
        accessorKey: "assignee",
        header: "Assignee",
        filter: {
          type: "static",
          options: people.map((p) => ({
            label: p.name,
            value: p.id
          }))
        }
      },
      {
        accessorKey: "tag",
        header: "Tag",
        filter: {
          type: "static",
          options: availableTags.map((tag) => ({
            label: tag,
            value: tag
          }))
        }
      },
      // Material facets (nesting compatibility) — only the properties present
      // on the current board's BOM lines are offered.
      ...(
        [
          { accessorKey: "substanceId", header: "Substance" },
          { accessorKey: "gradeId", header: "Grade" },
          { accessorKey: "dimensionId", header: "Dimension" },
          { accessorKey: "formId", header: "Form" },
          { accessorKey: "finishId", header: "Finish" }
        ] as const
      )
        .filter(
          ({ accessorKey }) =>
            (materialFacetOptions[accessorKey]?.length ?? 0) > 0
        )
        .map(({ accessorKey, header }) => ({
          accessorKey,
          header,
          filter: {
            type: "static" as const,
            isArray: true,
            options: (materialFacetOptions[accessorKey] ?? []).map((o) => ({
              label: o.name,
              value: o.id
            }))
          }
        }))
    ];
  }, [
    columns,
    processes,
    salesOrders,
    people,
    availableTags,
    materialFacetOptions
  ]);

  return (
    <div className="flex flex-col h-full max-h-full  overflow-auto relative">
      <HStack className="px-4 py-2 justify-between bg-card border-b border-border">
        <HStack>
          <ScheduleNavigation />
          <SearchFilter param="search" size="sm" placeholder="Search" />
          <Filter filters={filters} />
          <Tooltip>
            <TooltipTrigger tabIndex={-1} className="text-muted-foreground">
              <LuInfo className="w-4 h-4" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <Trans>
                Reorders dispatch sequence and work center only — does not
                reschedule. Change dates on the Dates board.
              </Trans>
            </TooltipContent>
          </Tooltip>
        </HStack>

        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <IconButton
                aria-label={t`Settings`}
                icon={<LuSettings2 />}
                variant="secondary"
                className="border-dashed border-border"
              />
            </PopoverTrigger>
            <PopoverContent className="w-64">
              <VStack spacing={3}>
                <span className="text-xs font-medium text-muted-foreground">
                  <Trans>Location</Trans>
                </span>
                <div className="w-full">
                  <Combobox
                    asButton
                    size="sm"
                    value={locationId}
                    options={locations}
                    onChange={(selected) => {
                      // hard refresh because initialValues update has no effect otherwise
                      window.location.href = getLocationPath(selected);
                    }}
                  />
                </div>
                <Separator />
                <span className="text-xs font-medium text-muted-foreground">
                  <Trans>Columns</Trans>
                </span>
                <VStack>
                  {(
                    [
                      {
                        key: "emptyWorkCenters",
                        label: t`Empty work centers`
                      }
                    ] as const
                  ).map(({ key, label }) => (
                    <Switch
                      key={key}
                      variant="small"
                      label={label}
                      checked={mergedDisplaySettings[key]}
                      onCheckedChange={(checked) =>
                        setDisplaySettings((prev) => ({
                          ...defaultDisplaySettings,
                          ...prev,
                          [key]: checked
                        }))
                      }
                    />
                  ))}
                </VStack>
                <Separator />
                <span className="text-xs font-medium text-muted-foreground">
                  <Trans>Cards</Trans>
                </span>
                <VStack>
                  {[
                    { key: "showCustomer", label: t`Customer` },
                    { key: "showDueDate", label: t`Due Date` },
                    { key: "showDuration", label: t`Duration` },
                    { key: "showMaterial", label: t`Material` },
                    { key: "showProgress", label: t`Progress` },
                    { key: "showQuantity", label: t`Quantity` },
                    { key: "showStatus", label: t`Status` },
                    { key: "showSalesOrder", label: t`Sales Order` },
                    { key: "showThumbnail", label: t`Thumbnail` }
                  ].map(({ key, label }) => (
                    <Switch
                      key={key}
                      variant="small"
                      label={label}
                      checked={
                        mergedDisplaySettings[
                          key as keyof typeof mergedDisplaySettings
                        ]
                      }
                      onCheckedChange={(checked) =>
                        setDisplaySettings((prev) => ({
                          ...defaultDisplaySettings,
                          ...prev,
                          [key]: checked
                        }))
                      }
                    />
                  ))}
                </VStack>
              </VStack>
            </PopoverContent>
          </Popover>
        </div>
      </HStack>
      {currentFilters.length > 0 && (
        <HStack className="px-4 py-1.5 justify-between bg-card border-b border-border w-full">
          <HStack>
            <ActiveFilters filters={filters} />
          </HStack>
        </HStack>
      )}
      <div className="flex flex-grow h-full items-stretch overflow-hidden relative">
        <div className="flex flex-1 min-h-0 w-full relative">
          {columns.length > 0 ? (
            <BatchSelectionProvider>
              <Kanban
                columns={visibleColumns}
                items={items}
                progressByItemId={progressByOperation}
                tags={tags}
                {...mergedDisplaySettings}
              />
              <BatchOpportunityBanner items={items} />
              <BatchSelectionBar
                locationId={locationId}
                batches={items.filter(isBatchItem)}
              />
            </BatchSelectionProvider>
          ) : hasFilters ? (
            <div className="flex flex-col w-full h-full items-center justify-center gap-4">
              <div className="flex justify-center items-center h-12 w-12 rounded-full bg-foreground text-background">
                <LuTriangleAlert className="h-6 w-6" />
              </div>
              <span className="text-xs font-mono font-light text-foreground uppercase">
                <Trans>No results</Trans>
              </span>
              <Button onClick={clearFilters}>
                <Trans>Clear Filters</Trans>
              </Button>
            </div>
          ) : (
            <div className="flex flex-col w-full h-full items-center justify-center gap-4">
              <div className="flex justify-center items-center h-12 w-12 rounded-full bg-foreground text-background">
                <LuTriangleAlert className="h-6 w-6" />
              </div>
              <span className="text-xs font-mono font-light text-foreground uppercase">
                <Trans>No work centers exist</Trans>
              </span>
              <Button leftIcon={<LuCirclePlus />} asChild>
                <Link to={path.to.newWorkCenter}>
                  <Trans>Create Work Center</Trans>
                </Link>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ScheduleRoute() {
  return (
    <ClientOnly
      fallback={
        <div className="flex h-full w-full items-center justify-center">
          <Spinner className="h-8 w-8" />
        </div>
      }
    >
      {() => <KanbanSchedule />}
    </ClientOnly>
  );
}

function useProgressByOperation(
  items: Item[],
  setItems: React.Dispatch<React.SetStateAction<Item[]>>,
  sortItems: (items: Item[]) => Item[]
) {
  const {
    company: { id: companyId }
  } = useUser();
  const { carbon } = useCarbon();

  const [productionEventsByOperation, setProductionEventsByOperation] =
    useState<Record<string, Event[]>>({});

  const [progressByOperation, setProgressByOperation] = useState<
    Record<string, Progress>
  >({});

  const getProductionEvents = useCallback(
    async (operationIds: string[]) => {
      if (!carbon) return;

      const { data, error } = await carbon
        .from("productionEvent")
        .select(
          "id, jobOperationId, duration, startTime, endTime, duration, employeeId"
        )
        .eq("companyId", companyId)
        .in("jobOperationId", operationIds);

      if (error) {
        toast.error(error.message);
      }

      if (data) {
        setProductionEventsByOperation(
          data.reduce<Record<string, Event[]>>((acc, event) => {
            acc[event.jobOperationId] = [
              ...(acc[event.jobOperationId] ?? []),
              event
            ];
            return acc;
          }, {})
        );
      }
    },
    [carbon, companyId]
  );

  useMount(() => {
    // Only real operation ids — collapsed batch cards use synthetic ids.
    getProductionEvents(
      items.filter((item) => !isBatchItem(item)).map((item) => item.id)
    );
  });

  const getProgress = useCallback(() => {
    const timeNow = now(getLocalTimeZone());
    const progress: Record<string, Progress> = {};

    Object.entries(productionEventsByOperation).forEach(
      ([operationId, events]) => {
        const found = items.find((item) => item.id === operationId);
        const operation = found && !isBatchItem(found) ? found : undefined;
        const totalDuration =
          (operation && "setupDuration" in operation
            ? (operation.setupDuration ?? 0)
            : 0) +
          (operation && "laborDuration" in operation
            ? (operation.laborDuration ?? 0)
            : 0) +
          (operation && "machineDuration" in operation
            ? (operation.machineDuration ?? 0)
            : 0);

        let currentProgress = 0;
        let active = false;
        let employees: Set<string> = new Set();
        events.forEach((event) => {
          if (event.endTime && event.duration) {
            currentProgress += event.duration * 1000;
          } else if (event.startTime) {
            active = true;

            if (event.employeeId) {
              employees.add(event.employeeId);
            }

            const startTime = toZoned(
              parseAbsolute(event.startTime, getLocalTimeZone()),
              getLocalTimeZone()
            );

            const difference = timeNow.compare(startTime);
            if (difference > 0) {
              currentProgress += difference;
            }
          }
        });

        progress[operationId] = {
          totalDuration,
          progress: currentProgress,
          active,
          employees
        };
      }
    );

    return { progress };
  }, [productionEventsByOperation, items]);

  useInterval(() => {
    const { progress } = getProgress();

    setProgressByOperation(progress);
  }, 5000);

  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    if (Object.keys(productionEventsByOperation).length > 0) {
      const { progress } = getProgress();
      setProgressByOperation(progress);
    }
  }, [productionEventsByOperation]);

  useRealtimeChannel({
    topic: `kanban-schedule:${companyId}`,
    setup(channel) {
      return channel
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "jobOperation",
            filter: `id=in.(${items
              .filter((item) => !isBatchItem(item))
              .map((item) => item.id)
              .join(",")})`
          },
          (payload) => {
            switch (payload.eventType) {
              case "UPDATE": {
                const { new: updated } = payload;
                setItems((prevItems: Item[]) =>
                  sortItems(
                    prevItems.map((item: Item) => {
                      if (item.id === updated.id) {
                        return {
                          ...item,
                          columnId: updated.workCenterId,
                          priority: updated.priority
                        };
                      }
                      return item;
                    })
                  )
                );
                break;
              }
              case "DELETE": {
                const { old: deleted } = payload;
                setItems((prevItems: Item[]) =>
                  sortItems(
                    prevItems.filter((item: Item) => item.id !== deleted.id)
                  )
                );
                break;
              }
            }
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "productionEvent",
            filter: `companyId=eq.${companyId}`
          },
          (payload) => {
            if (payload.eventType === "INSERT") {
              const { new: inserted } = payload;
              if (inserted.jobOperationId) {
                setProductionEventsByOperation((prevState) => ({
                  ...prevState,
                  [inserted.jobOperationId]: [
                    ...(prevState[inserted.jobOperationId] ?? []),
                    inserted
                  ]
                }));
              }
            } else if (payload.eventType === "UPDATE") {
              const { new: updated } = payload;
              if (updated.jobOperationId) {
                setProductionEventsByOperation((prevState) => ({
                  ...prevState,
                  [updated.jobOperationId]: (
                    prevState[updated.jobOperationId] ?? []
                  ).map((event) => (event.id === updated.id ? updated : event))
                }));
              }
            } else if (payload.eventType === "DELETE") {
              const { old: deleted } = payload;
              if (deleted.jobOperationId) {
                setProductionEventsByOperation((prevState) => ({
                  ...prevState,
                  [deleted.jobOperationId]: (
                    prevState[deleted.jobOperationId] ?? []
                  ).filter((event) => event.id !== deleted.id)
                }));
              }
            }
          }
        );
    }
  });

  return { progressByOperation };
}

function getLocationPath(locationId: string) {
  return `${path.to.scheduleOperation}?location=${locationId}`;
}
