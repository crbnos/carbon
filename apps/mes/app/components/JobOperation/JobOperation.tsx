import type { Result } from "@carbon/auth";
import { useCarbon } from "@carbon/auth";
import type { Database } from "@carbon/database";
import { convertKbToString } from "@carbon/files";
import { getLogger } from "@carbon/logger";
import type { JSONContent } from "@carbon/react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  BarProgress,
  BottomSheet,
  BottomSheetBody,
  BottomSheetContent,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Copy,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  generateHTML,
  Heading,
  HStack,
  IconButton,
  ScrollArea,
  Separator,
  SidebarTrigger,
  Table,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tbody,
  Td,
  Th,
  Thead,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Tr,
  toast,
  useDisclosure,
  useKeyboardWedge,
  useMode,
  useRouteData,
  VStack
} from "@carbon/react";
import type { TrackedEntityAttributes } from "@carbon/utils";
import {
  batchPlanBreakdown,
  convertDateStringToIsoString,
  formatDate,
  formatDurationMilliseconds,
  getItemReadableId,
  MODEL_RAW_KEEP_MAX_BYTES,
  round
} from "@carbon/utils";
import { ModelPreview } from "@carbon/viewer/model-preview";
import { OptimizeProgress } from "@carbon/viewer/optimize-progress";
import { useOptimizedModel } from "@carbon/viewer/use-optimized-model";
import { parseDate } from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import type { PostgrestSingleResponse } from "@supabase/supabase-js";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { FaCheck, FaPlus, FaTrash } from "react-icons/fa6";
import {
  LuArrowLeft,
  LuAxis3D,
  LuBarcode,
  LuCheck,
  LuChevronDown,
  LuChevronLeft,
  LuChevronRight,
  LuCirclePlay,
  LuCirclePlus,
  LuClipboardCheck,
  LuDownload,
  LuEllipsisVertical,
  LuGitBranchPlus,
  LuGitPullRequest,
  LuLayers,
  LuPackageCheck,
  LuPrinter,
  LuQrCode,
  LuSquareUser,
  LuTimer,
  LuTriangleAlert,
  LuWrench
} from "react-icons/lu";
import { Await, Link, useFetcher, useNavigate, useParams } from "react-router";
import {
  DateTime,
  DeadlineIcon,
  FileIcon,
  FilePreview,
  OperationStatusIcon,
  PrintButton
} from "~/components";
import {
  MethodIcon,
  MethodItemTypeIcon,
  TrackingTypeIcon
} from "~/components/Icons";
import { useDateFormatter, useUrlParams, useUser } from "~/hooks";
import type { productionEventType } from "~/services/models";
import type {
  BatchMaterialTotal,
  BatchWorkInstructions,
  JobOperationBatch
} from "~/services/operations.service";
import { getFileType } from "~/services/operations.service";
import type {
  Job,
  JobMakeMethod,
  JobMaterial,
  JobOperationParameter,
  JobOperationStep,
  Kanban,
  OperationWithDetails,
  ProductionEvent,
  StorageItem,
  TrackedEntity,
  TrackedInput
} from "~/services/types";
import { useItems } from "~/stores";
import { makeDurations } from "~/utils/durations";
import { getPrivateUrl, getRawModelUrl, path } from "~/utils/path";
import ItemThumbnail from "../ItemThumbnail";
import { BatchCompleteModal } from "./components/BatchCompleteModal";
import { BatchOverview } from "./components/BatchOverview";
import { OperationChat } from "./components/Chat";
import {
  Controls,
  IconButtonWithTooltip,
  StartStopButton,
  Times,
  WorkTypeToggle
} from "./components/Controls";
import { IssueMaterialModal } from "./components/IssueMaterialModal";
import { MaintenanceDispatch } from "./components/MaintenanceDispatch";
import { ParametersListItem } from "./components/Parameter";
import { QualityIssueModal } from "./components/QualityIssueModal";
import { QuantityModal } from "./components/QuantityModal";
import { ReworkModal } from "./components/ReworkModal";
import { SerialSelectorModal } from "./components/SerialSelectorModal";
import {
  DeleteStepRecordModal,
  RecordModal,
  StepsListItem
} from "./components/Step";
import { TableSkeleton } from "./components/TableSkeleton";
import { useFiles } from "./hooks/useFiles";
import { useOperation } from "./hooks/useOperation";

const DOCK_COLLAPSED_KEY = "mes:operation-dock-collapsed";

const log = getLogger("mes", "job-operation");

type JobOperationProps = {
  // Present only when the op belongs to an Active/Completing batch; the loader
  // resolves it and swaps in the batch's events. In batch mode the timers and
  // completion act on the whole batch.
  batch: JobOperationBatch | null;
  // Batch mode: the combined per-item requirement/issued across every member,
  // so the materials panel shows the one shared pick (e.g. 6,500 seeds).
  batchMaterialTotals?: Record<string, BatchMaterialTotal> | null;
  batchWorkInstructions?: Promise<BatchWorkInstructions> | null;
  events: ProductionEvent[];
  expiredEntityPolicy?: "Warn" | "Block" | "BlockWithOverride";
  autoSelectMaterialWithoutPickingList?: boolean;
  files: Promise<StorageItem[]>;
  kanban: Kanban | null;
  materials: Promise<{
    materials: JobMaterial[];
    trackedInputs: TrackedInput[];
  }>;
  method: JobMakeMethod | null;
  nonConformanceActions: Promise<
    {
      id: string;
      nonConformanceId: string;
      actionTypeName: string;
      assignee: string;
      notes: JSONContent;
    }[]
  >;
  operation: OperationWithDetails;
  procedure: Promise<{
    attributes: JobOperationStep[];
    parameters: JobOperationParameter[];
  }>;
  job: Job;
  thumbnailPath: string | null;
  trackedEntities: TrackedEntity[];
  isFirstOperation: boolean;
  workCenter: Promise<
    PostgrestSingleResponse<{
      name: string;
      id: string;
      isBlocked: boolean | null;
      blockingDispatchId: string | null;
      blockingDispatchReadableId: string | null;
    }>
  >;
};

/**
 * Additive overlay badge showing how much of a material has been picked (staged at
 * lineside). Picking is optional, so this renders nothing unless something has actually
 * been picked — orange while partial, green once the full requirement is staged.
 */
function PickedBadge({
  quantityPicked,
  quantityToPick
}: {
  quantityPicked?: number | null;
  quantityToPick?: number | null;
}) {
  const picked = Number(quantityPicked ?? 0);
  if (picked <= 0) return null;
  const toPick = Number(quantityToPick ?? 0);
  const isFullyPicked = toPick > 0 && picked >= toPick;
  return (
    <Badge
      variant={isFullyPicked ? "green" : "orange"}
      className="gap-1 shrink-0"
      title="Quantity picked to lineside"
    >
      <LuPackageCheck className="size-3" />
      {isFullyPicked ? <Trans>Picked</Trans> : `${picked}/${toPick}`}
    </Badge>
  );
}

function PickedBreakdown({
  materialItemId,
  pickedByItem
}: {
  materialItemId: string | null | undefined;
  pickedByItem?:
    | {
        itemId: string;
        itemReadableId: string;
        quantityPicked: number;
        quantityToPick: number;
      }[]
    | null;
}) {
  const picks = pickedByItem ?? [];
  if (!picks.some((p) => p.itemId !== materialItemId)) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 text-xs text-blue-700 dark:text-blue-300">
      <span>
        <Trans>Picked as</Trans>
      </span>
      {picks.map((pick) => {
        const isFullyPicked =
          pick.quantityToPick > 0 && pick.quantityPicked >= pick.quantityToPick;
        return (
          <Badge
            key={pick.itemId}
            variant={
              isFullyPicked
                ? "green"
                : pick.quantityPicked > 0
                  ? "orange"
                  : "secondary"
            }
            className="gap-1 shrink-0"
          >
            {isFullyPicked
              ? pick.quantityPicked
              : `${pick.quantityPicked}/${pick.quantityToPick}`}
            {" × "}
            {pick.itemReadableId}
          </Badge>
        );
      })}
    </div>
  );
}

export const JobOperation = ({
  batch,
  batchMaterialTotals,
  batchWorkInstructions,
  events,
  expiredEntityPolicy = "Block",
  autoSelectMaterialWithoutPickingList = false,
  files,
  job,
  kanban,
  materials,
  method,
  nonConformanceActions,
  operation: originalOperation,
  procedure,
  thumbnailPath,
  trackedEntities,
  isFirstOperation,
  workCenter
}: JobOperationProps) => {
  const { t } = useLingui();
  const { formatRelativeTime } = useDateFormatter();
  const [params, setParams] = useUrlParams();

  const trackedEntityParam = params.get("trackedEntityId");
  const trackedEntityId = trackedEntityParam ?? trackedEntities[0]?.id;

  const parentIsSerial = method?.requiresSerialTracking;
  const parentIsBatch = method?.requiresBatchTracking;

  // Batch mode: the loader only passes `batch` when the op belongs to an
  // Active/Completing batch, so its presence is the switch. In batch mode the
  // Start/Stop timer, planned durations, and completion all act on the whole
  // batch rather than this single member.
  const isBatched = !!batch;
  // A batched operation opens on the whole batch; "?scope=job" narrows to this
  // job's own details. Kept in the URL so a member link can land on either.
  const scope: "batch" | "job" =
    isBatched && params.get("scope") !== "job" ? "batch" : "job";
  const isCompleting = batch?.status === "Completing";
  // What the header and dock say about the batch as a whole — never one
  // member's values, which is what made the batch scope read as a job.
  const batchFacts = useMemo(() => {
    if (!batch) return null;
    const members = batch.operations ?? [];
    const jobs = members.map(
      (m) =>
        m.job as {
          deadlineType?: string | null;
          customer?: { name?: string | null } | null;
        } | null
    );
    const unique = (values: (string | null | undefined)[]) => [
      ...new Set(values.filter((v): v is string => !!v))
    ];
    const dueDates = members
      .filter(
        (m, i) =>
          m.dueDate &&
          !["ASAP", "No Deadline"].includes(jobs[i]?.deadlineType ?? "")
      )
      .map((m) => m.dueDate as string)
      .sort();
    return {
      customers: unique(jobs.map((j) => j?.customer?.name)),
      items: unique(
        members.map((m) => m.jobMakeMethod?.item?.readableIdWithRevision)
      ),
      dueDate: dueDates[0] ?? null,
      deadline: dueDates[0]
        ? null
        : jobs.some((j) => j?.deadlineType === "ASAP")
          ? "ASAP"
          : "No Deadline"
    };
  }, [batch]);
  // Same instant comparison the job's own deadline uses (useOperation).
  const batchOverdue = batchFacts?.dueDate
    ? new Date(batchFacts.dueDate) < new Date()
    : false;
  const batchCompleteModal = useDisclosure();
  // The completion fetcher lives HERE, not in BatchCompleteModal: a successful
  // completion flips the batch out of Active/Completing, the loader stops
  // passing `batch`, and the modal unmounts mid-flight.
  const batchCompleteFetcher = useFetcher<{ completed?: boolean }>();

  const serialIndex =
    trackedEntities.findIndex((entity) => entity.id === trackedEntityId) ?? 0;

  const navigate = useNavigate();
  useEffect(() => {
    if (
      batchCompleteFetcher.state === "idle" &&
      batchCompleteFetcher.data?.completed
    ) {
      navigate(path.to.operations);
    }
  }, [batchCompleteFetcher.state, batchCompleteFetcher.data, navigate]);
  const { carbon } = useCarbon();
  const {
    id: userId,
    company: { id: companyId }
  } = useUser();

  const [items] = useItems();
  const { downloadFile, downloadModel, getFilePath } = useFiles(job);

  const attributeRecordModal = useDisclosure();
  const attributeRecordDeleteModal = useDisclosure();
  const maintenanceModal = useDisclosure();
  const qualityIssueModal = useDisclosure();
  const [activeStep, setActiveStep] = useState(
    parentIsSerial ? serialIndex : 0
  );
  const [hasMultipleRecords, setHasMultipleRecords] = useState(false);

  useEffect(() => {
    if (parentIsSerial) {
      setActiveStep(serialIndex);
    }
  }, [parentIsSerial, serialIndex]);

  const isModalOpen =
    attributeRecordModal.isOpen || attributeRecordDeleteModal.isOpen;

  const {
    actionsSheet,
    availableEntities,
    active,
    activeTab,
    completeModal,
    eventType,
    finishModal,
    isOverdue,
    issueModal,
    laborProductionEvent,
    machineProductionEvent,
    operation,
    progress,
    reworkModal,
    scrapModal,
    serialModal,
    selectedMaterial,
    setActiveTab,
    setEventType,
    setSelectedMaterial,
    setupProductionEvent
  } = useOperation({
    operation: originalOperation,
    events,
    trackedEntities,
    isFirstOperation,
    requiresSerialTracking: !!parentIsSerial,
    pauseInterval: isModalOpen,
    procedure,
    // In batch mode the realtime subscription follows the batch's events (all
    // members) rather than this operation's own.
    batchId: batch?.id,
    // First operation only (no labels to scan yet): auto-select the next unit.
    // `activeStep` follows `trackedEntityId` via the sync effect above, so setting
    // the URL param is all that's needed.
    onAdvanceToUnit: (entity) => {
      setParams({ trackedEntityId: entity.id });
    }
  });
  // Batch mode: the selected material's outstanding requirement ACROSS the
  // batch — the shared pick is split pro-rata over every member, so defaulting
  // to one member's share would under-serve all of them.
  const selectedBatchRemaining = (() => {
    if (!isBatched || !selectedMaterial?.itemId) return undefined;
    const totals = batchMaterialTotals?.[selectedMaterial.itemId];
    return totals
      ? Math.max(0, round(totals.required - totals.issued))
      : undefined;
  })();

  // In batch mode the shared timer is judged against the batch's TOTAL plan:
  // ONE shared setup (the largest member's — that is the point of batching), the
  // per-type labor/machine buckets (the `Times` denominators), and a wall-clock
  // `duration` (setup + each member's run — the longer of its labor and machine
  // — combined per the process's batch type), shared with the scheduler and the
  // ERP surfaces via `@carbon/utils` `batchPlanBreakdown`. `displayOperation`
  // feeds the info-bar duration, the work-type toggle, the Times denominators,
  // and controlsHeight so a batch timer reads against the whole batch, not one
  // member. A batch with no planned time anywhere still gets a Machine timer
  // (fallback of 1).
  const displayOperation = useMemo<OperationWithDetails>(() => {
    if (!batch) return operation;
    const durations = (batch.operations ?? []).map((m) => {
      try {
        const d = makeDurations({
          setupTime: m.setupTime ?? 0,
          setupUnit: (m.setupUnit ?? "Total Minutes") as string,
          laborTime: m.laborTime ?? 0,
          laborUnit: (m.laborUnit ?? "Minutes/Piece") as string,
          machineTime: m.machineTime ?? 0,
          machineUnit: (m.machineUnit ?? "Minutes/Piece") as string,
          operationQuantity: m.operationQuantity
        });
        return {
          setupDuration: d.setupDuration,
          laborDuration: d.laborDuration,
          machineDuration: d.machineDuration
        };
      } catch {
        // A member without times contributes nothing.
        return { setupDuration: 0, laborDuration: 0, machineDuration: 0 };
      }
    });
    const plan = batchPlanBreakdown(
      durations,
      batch.process?.batchType ?? "Sequential"
    );
    const totals = {
      setupDuration: plan.setup,
      laborDuration: plan.labor,
      machineDuration: plan.machine
    };
    let duration = plan.total;
    // No planned time anywhere → keep a drawable Machine timer so the operator
    // can still record work (the total follows the fallback bucket).
    if (
      totals.setupDuration === 0 &&
      totals.laborDuration === 0 &&
      totals.machineDuration === 0
    ) {
      totals.machineDuration = 1;
      duration = 1;
    }
    return {
      ...operation,
      ...totals,
      duration
    };
  }, [batch, operation]);

  const projectedCompletionDate = operation.projectedCompletionAt
    ? operation.projectedCompletionAt.slice(0, 10)
    : null;
  const daysBehindTarget =
    projectedCompletionDate && operation.operationDueDate
      ? parseDate(projectedCompletionDate).compare(
          parseDate(operation.operationDueDate.slice(0, 10))
        )
      : 0;
  const isBehindTarget = daysBehindTarget > 0;

  // The status bar's quantity meter counts the whole run when batched.
  const quantityProgress = useMemo(() => {
    if (!batch) {
      return {
        complete: operation.quantityComplete,
        target: operation.targetQuantity,
        reworked: operation.quantityReworked ?? 0,
        scrapped: operation.quantityScrapped ?? 0
      };
    }
    const members = batch.operations ?? [];
    return {
      complete: members.reduce((n, m) => n + (m.quantityComplete ?? 0), 0),
      target: members.reduce((n, m) => n + (m.operationQuantity ?? 0), 0),
      reworked: 0,
      scrapped: members.reduce((n, m) => n + (m.quantityScrapped ?? 0), 0)
    };
  }, [batch, operation]);

  // The action panel only exists on some tabs.
  const workTypeLabels = {
    setup: t`Setup`,
    labor: t`Labor`,
    machine: t`Machine`
  } as const;
  const runningType = (["setup", "labor", "machine"] as const).find(
    (type) => active[type]
  );
  // Chat is one job's thread, so a Chat tab left open in the job scope falls
  // back to Details on the batch.
  const tab = scope === "batch" && activeTab === "chat" ? "details" : activeTab;
  const showControls = !["chat", "procedure"].includes(tab);
  // Read after mount (never during render) so SSR and the first client
  // render agree; storage can throw in private/locked-down browsers.
  const [dockCollapsed, setDockCollapsed] = useState(false);
  useEffect(() => {
    try {
      setDockCollapsed(localStorage.getItem(DOCK_COLLAPSED_KEY) === "true");
    } catch {
      // storage unavailable: keep the default (expanded)
    }
  }, []);
  const onDockCollapsedChange = useCallback((collapsed: boolean) => {
    setDockCollapsed(collapsed);
    try {
      localStorage.setItem(DOCK_COLLAPSED_KEY, String(collapsed));
    } catch {
      // storage unavailable: the choice lasts for this page only
    }
  }, []);

  const mode = useMode();
  const { operationId } = useParams();

  const modelUpload =
    job.modelPath || operation.itemModelPath
      ? {
          modelPath: operation.itemModelPath ?? job.modelPath,
          modelId: operation.itemModelId ?? job.modelId,
          modelName: operation.itemModelName ?? job.modelName,
          modelSize: operation.itemModelSize ?? job.modelSize
        }
      : null;

  const modelPath = operation.itemModelPath ?? job.modelPath ?? null;
  // Prefer the authoritative id (mirrors the modelPath precedence) over deriving
  // it from the path — legacy paths whose basename isn't the id would otherwise
  // resolve a phantom id and 404 the artifacts/reoptimise lookups.
  const modelUploadId = operation.itemModelId ?? job.modelId ?? null;
  const {
    artifacts,
    awaitingModel: modelPending,
    showOptimizeProgress,
    backgroundOptimizing,
    optimizeFailed,
    canRetry,
    optimizeQueued,
    retry: onModelRetry,
    retryLabel: modelRetryLabel,
    cancel: onModelCancel,
    actionBusy: modelActionBusy
  } = useOptimizedModel({ modelPath, modelUploadId, companyId });

  const fetcher = useFetcher<Result>();

  // Lazy creation of Inspection steps for non-conformance actions
  // biome-ignore lint/correctness/useExhaustiveDependencies: suppressed due to migration
  useEffect(() => {
    async function createInspectionStepsForNonConformanceActions() {
      if (!carbon || !operationId) return;

      try {
        const activeActions = await nonConformanceActions;
        const resolvedProcedure = await procedure;

        if (activeActions.length === 0) return;

        // Check which actions already have corresponding inspection steps
        const existingSteps = resolvedProcedure.attributes.filter(
          (step: any) =>
            step.type === "Inspection" && step.nonConformanceActionId != null
        );

        const existingActionIds = new Set(
          existingSteps.map((step: any) => step.nonConformanceActionId)
        );

        // Create inspection steps for actions that don't have them
        const newSteps: Database["public"]["Tables"]["jobOperationStep"]["Insert"][] =
          [];
        let maxSortOrder = Math.max(
          ...resolvedProcedure.attributes.map((s) => s.sortOrder ?? 0),
          0
        );

        for (const action of activeActions) {
          // Assuming the action object has an id field
          const actionId = action.id;
          if (!actionId || existingActionIds.has(actionId)) continue;

          newSteps.push({
            companyId,
            createdBy: userId,
            operationId,
            name: `${action.actionTypeName} - ${action.nonConformanceId}`,
            type: "Inspection" as const,
            sortOrder: ++maxSortOrder,
            nonConformanceActionId: actionId
          });
        }

        if (newSteps.length > 0) {
          fetcher.submit(JSON.stringify(newSteps), {
            method: "post",
            action: path.to.inspectionSteps,
            encType: "application/json"
          });
        }
      } catch (error) {
        log.error(
          "Failed to create inspection steps for non-conformance actions",
          { error }
        );
      }
    }

    createInspectionStepsForNonConformanceActions();
  }, [
    carbon,
    operationId,
    nonConformanceActions,
    procedure,
    companyId,
    userId
  ]);

  const [selectedStep, setSelectedStep] = useState<JobOperationStep | null>(
    null
  );

  const onRecordStepRecord = (attribute: JobOperationStep) => {
    flushSync(() => {
      setSelectedStep(attribute);
    });
    attributeRecordModal.onOpen();
  };

  const onDeleteStepRecord = (attribute: JobOperationStep) => {
    flushSync(() => {
      setSelectedStep(attribute);
    });
    attributeRecordDeleteModal.onOpen();
  };

  const onDeselectStep = () => {
    setSelectedStep(null);
    attributeRecordModal.onClose();
    attributeRecordDeleteModal.onClose();
  };

  const layoutData = useRouteData<{ location: string }>(
    path.to.authenticatedRoot
  );
  const locationId = layoutData?.location;

  const completeFetcher = useFetcher<Result>();
  useKeyboardWedge({
    test: (input) => {
      if (kanban?.completedBarcodeOverride) {
        return input === kanban.completedBarcodeOverride;
      } else if (kanban?.id) {
        return input === path.to.kanbanComplete(kanban.id);
      }
      return false;
    },
    callback: () => {
      completeFetcher.load(path.to.endOperation(operation.id));
    },
    // The wedge completes this single op via endOperation — never for a batched
    // member; the batch completes as a whole.
    active: !!kanban?.id && !isBatched
  });

  const item = items.find((it) => it.id === operation.itemId);

  // Mounted by BOTH the per-job materials table and the batch overview —
  // the batch scope's Pick opens the same shared-pick modal.
  const renderIssueModal = (
    resolvedMaterials: Awaited<typeof materials> | undefined
  ) =>
    issueModal.isOpen ? (
      <IssueMaterialModal
        operationId={operation.id}
        // The process view issues the whole quantity at
        // once, so picked lots may pre-fill when the
        // parent is a single entity. The modal enforces
        // the full rule: a picking list exists AND (the
        // parent is not serialized OR the operation
        // makes exactly one unit).
        allowPrefill
        parentUnitCount={operation.operationQuantity ?? undefined}
        expiredEntityPolicy={expiredEntityPolicy}
        autoSelectMaterialWithoutPickingList={
          autoSelectMaterialWithoutPickingList
        }
        locationId={locationId}
        workCenterId={operation.workCenterId ?? undefined}
        material={selectedMaterial ?? undefined}
        batchId={batch?.id ?? undefined}
        batchRemainingQuantity={selectedBatchRemaining}
        parentId={trackedEntityId ?? ""}
        parentIdIsSerialized={method?.requiresSerialTracking ?? false}
        trackedInputs={resolvedMaterials?.trackedInputs ?? []}
        onClose={() => {
          setSelectedMaterial(null);
          issueModal.onClose();
        }}
      />
    ) : null;

  return (
    <>
      <Tabs
        key={`operation-${operation.id}`}
        value={tab}
        onValueChange={setActiveTab}
        // An application shell, not a page: a grid of named areas where each
        // pane scrolls on its own, so nothing is positioned or sized by hand.
        // Below lg the dock is a bottom action bar; from lg it is a column
        // beside the workspace and status bar. The outlet frame is only
        // min-height bounded (other MES screens page-scroll), so the shell takes
        // the viewport itself, less the frame's md:my-2 inset.
        className="grid h-svh md:h-[calc(100svh-1rem)] min-h-0 w-full min-w-0 bg-card grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_auto_minmax(0,1fr)_auto_auto] [grid-template-areas:'header'_'context'_'sep'_'main'_'status'_'dock'] lg:grid-cols-[minmax(0,1fr)_auto] lg:grid-rows-[auto_auto_auto_minmax(0,1fr)_auto] lg:[grid-template-areas:'header_header'_'context_context'_'sep_sep'_'main_dock'_'status_dock']"
      >
        <header className="[grid-area:header] flex h-[var(--header-height)] shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12 border-b px-2">
          <HStack className="w-full justify-between">
            <div className="flex items-center gap-0">
              <SidebarTrigger />

              <Button
                variant="ghost"
                leftIcon={<LuChevronLeft />}
                onClick={() => navigate(path.to.operations)}
                className="pl-2"
              >
                <Trans>Schedule</Trans>
              </Button>
            </div>
            <div className="flex min-w-0 items-center gap-2 overflow-x-auto scrollbar-hide scroll-fade-x">
              <TabsList className="ml-auto shrink-0">
                <TabsTrigger value="details">
                  <Trans>Details</Trans>
                </TabsTrigger>
                <TabsTrigger
                  disabled={!job.modelPath && !operation.itemModelPath}
                  value="model"
                >
                  <Trans>Model</Trans>
                </TabsTrigger>
                <TabsTrigger value="procedure">
                  <Trans>Instructions</Trans>
                </TabsTrigger>
                {/* Notes are kept per job operation — on the batch there is no
                    one thread to show, so Chat opens from a job. */}
                <TabsTrigger value="chat" disabled={scope === "batch"}>
                  <Trans>Chat</Trans>
                </TabsTrigger>
              </TabsList>
            </div>
          </HStack>
        </header>

        <div className="[grid-area:context] flex shrink-0 flex-wrap lg:flex-nowrap items-center justify-start px-4 lg:pl-6 py-2 min-h-[var(--header-height)] bg-card gap-x-2 gap-y-1 md:gap-x-4 w-full min-w-0">
          <HStack className="min-w-22 shrink-0 justify-between">
            {batch ? (
              // One control for "which part of the batch am I looking at":
              // the batch, this job, or (via the chevron) another member job.
              <div className="flex shrink-0 items-center rounded-full border bg-card p-0.5 text-sm">
                <button
                  type="button"
                  aria-pressed={scope === "batch"}
                  aria-label={t`Whole batch`}
                  onClick={() => setParams({ scope: "" })}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-3 py-1 transition-[background-color,color,transform] active:scale-[0.98]",
                    scope === "batch"
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <LuLayers className="size-3.5" />
                  <span className="font-medium tabular-nums">
                    {batch.readableId}
                  </span>
                  <span className="opacity-60">
                    {t`${(batch.operations ?? []).length} jobs`}
                  </span>
                  {isCompleting && (
                    <Badge variant="yellow" className="ml-0.5">
                      <Trans>Completing</Trans>
                    </Badge>
                  )}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-pressed={scope === "job"}
                      aria-label={t`Choose a job`}
                      className={cn(
                        "flex items-center gap-1 rounded-full py-1 pl-3 pr-2 font-medium transition-[background-color,color,transform] active:scale-[0.98]",
                        scope === "job"
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {scope === "job" ? (
                        operation.jobReadableId
                      ) : (
                        <Trans>Jobs</Trans>
                      )}
                      <LuChevronDown className="size-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-[240px]">
                    <DropdownMenuLabel>
                      <Trans>Open a job in this batch</Trans>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {[...(batch.operations ?? [])]
                      .sort((a, b) =>
                        (
                          (a.job as { jobId?: string | null } | null)?.jobId ??
                          ""
                        ).localeCompare(
                          (b.job as { jobId?: string | null } | null)?.jobId ??
                            "",
                          undefined,
                          { numeric: true }
                        )
                      )
                      .map((member) => {
                        const isOpen =
                          scope === "job" && member.id === operation.id;
                        return (
                          <DropdownMenuItem key={member.id} asChild>
                            <Link
                              to={`${path.to.operation(member.id)}?scope=job`}
                            >
                              <DropdownMenuIcon
                                icon={
                                  isOpen ? (
                                    <LuCheck className="text-emerald-500" />
                                  ) : (
                                    <LuClipboardCheck />
                                  )
                                }
                              />
                              <span className="truncate">
                                {(
                                  member.job as { jobId?: string | null } | null
                                )?.jobId ?? member.id}
                                {member.jobMakeMethod?.item
                                  ?.readableIdWithRevision
                                  ? ` — ${member.jobMakeMethod.item.readableIdWithRevision}`
                                  : ""}
                              </span>
                            </Link>
                          </DropdownMenuItem>
                        );
                      })}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : (
              <Heading size="h4">{operation.jobReadableId}</Heading>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  aria-label="More options"
                  variant="ghost"
                  icon={<LuEllipsisVertical />}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {scope === "job" && (
                  <DropdownMenuItem asChild>
                    <a
                      href={path.to.file.jobTraveler(operation.jobMakeMethodId)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <DropdownMenuIcon icon={<LuQrCode />} />
                      <Trans>Job Traveler</Trans>
                    </a>
                  </DropdownMenuItem>
                )}
                {scope === "job" && (
                  <DropdownMenuItem asChild>
                    <Link to={path.to.jobDetail(operation.jobId)}>
                      <DropdownMenuIcon icon={<LuCirclePlay />} />
                      <Trans>Job Details</Trans>
                    </Link>
                  </DropdownMenuItem>
                )}
                {scope === "batch" && batch && (
                  <DropdownMenuItem asChild>
                    <a
                      href={path.to.batchDetail(batch.id as string)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <DropdownMenuIcon icon={<LuLayers />} />
                      <Trans>Batch Details</Trans>
                    </a>
                  </DropdownMenuItem>
                )}
                {scope === "batch" && batch && (
                  <DropdownMenuItem asChild>
                    <a
                      href={path.to.file.batchList(batch.id as string)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <DropdownMenuIcon icon={<LuPrinter />} />
                      <Trans>Print batch list</Trans>
                    </a>
                  </DropdownMenuItem>
                )}
                {item &&
                  (scope === "job" || batchFacts?.items.length === 1) && (
                    <DropdownMenuItem asChild>
                      <Link to={path.to.itemMaster(item?.id, item.type)}>
                        <DropdownMenuIcon
                          icon={<MethodItemTypeIcon type={item.type} />}
                        />
                        <Trans>Item Master</Trans>
                      </Link>
                    </DropdownMenuItem>
                  )}
              </DropdownMenuContent>
            </DropdownMenu>
          </HStack>

          <HStack className="flex w-full lg:w-auto min-w-0 lg:flex-1 justify-start lg:justify-end items-center gap-3 overflow-x-auto lg:overflow-hidden scrollbar-hide scroll-fade-x [&>*]:shrink-0 lg:[&>*]:shrink">
            {scope === "batch" && batchFacts
              ? batchFacts.customers.length > 0 && (
                  <HStack className="min-w-0 justify-start space-x-2">
                    <LuSquareUser className="text-muted-foreground shrink-0" />
                    <span className="text-sm truncate">
                      {batchFacts.customers.length === 1
                        ? batchFacts.customers[0]
                        : t`${batchFacts.customers.length} customers`}
                    </span>
                  </HStack>
                )
              : job.customer?.name && (
                  <HStack className="min-w-0 justify-start space-x-2">
                    <LuSquareUser className="text-muted-foreground shrink-0" />
                    <span className="text-sm truncate">
                      {job.customer.name}
                    </span>
                  </HStack>
                )}
            {operation.description && (
              <HStack className="min-w-0 justify-start space-x-2">
                <LuClipboardCheck className="text-muted-foreground shrink-0" />
                <span className="text-sm truncate">
                  {operation.description}
                </span>
              </HStack>
            )}
            {scope === "batch" && batch ? (
              <HStack className="min-w-0 shrink-0 justify-start space-x-2">
                <LuLayers className="text-muted-foreground shrink-0" />
                <span className="text-sm truncate">
                  {isCompleting ? t`Completing` : t`Released`}
                </span>
              </HStack>
            ) : (
              operation.operationStatus && (
                <HStack className="min-w-0 shrink-0 justify-start space-x-2">
                  <OperationStatusIcon
                    status={
                      operation.jobStatus === "Paused"
                        ? "Paused"
                        : operation.operationStatus
                    }
                  />
                  <span className="text-sm truncate">
                    {operation.jobStatus === "Paused"
                      ? "Paused"
                      : operation.operationStatus}
                  </span>
                </HStack>
              )
            )}
            {/* Batch mode shows the batch's planned total (shared setup +
                summed work); a zero plan renders nothing rather than
                "0 milliseconds". */}
            {typeof displayOperation.duration === "number" &&
              displayOperation.duration > 1 && (
                <HStack className="min-w-0 shrink-0 justify-start space-x-2">
                  <LuTimer className="text-muted-foreground shrink-0" />
                  <span className="text-sm truncate tabular-nums">
                    {formatDurationMilliseconds(displayOperation.duration)}
                  </span>
                </HStack>
              )}
            {scope === "batch" && batchFacts ? (
              <HStack className="min-w-0 shrink-0 justify-start space-x-2">
                <DeadlineIcon
                  deadlineType={
                    (batchFacts.deadline ??
                      "Hard Deadline") as typeof operation.jobDeadlineType
                  }
                  overdue={batchOverdue}
                />
                <span
                  className={cn(
                    "text-sm truncate",
                    batchOverdue ? "text-red-500" : ""
                  )}
                >
                  {batchFacts.dueDate
                    ? t`First due ${formatRelativeTime(
                        convertDateStringToIsoString(batchFacts.dueDate)
                      )}`
                    : batchFacts.deadline}
                </span>
              </HStack>
            ) : (
              operation.jobDeadlineType && (
                <HStack className="min-w-0 shrink-0 justify-start space-x-2">
                  <DeadlineIcon
                    deadlineType={operation.jobDeadlineType}
                    overdue={isOverdue}
                  />

                  <span
                    className={cn(
                      "text-sm truncate",
                      isOverdue ? "text-red-500" : ""
                    )}
                  >
                    {["ASAP", "No Deadline"].includes(operation.jobDeadlineType)
                      ? operation.jobDeadlineType
                      : operation.operationDueDate
                        ? t`Due ${formatRelativeTime(
                            convertDateStringToIsoString(
                              operation.operationDueDate
                            )
                          )}`
                        : "–"}
                  </span>
                </HStack>
              )
            )}
          </HStack>
        </div>
        <Separator className="[grid-area:sep]" />

        <TabsContent
          value="details"
          className="[grid-area:main] mt-0 h-full min-h-0 overflow-y-auto scroll-fade scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
        >
          <div className="w-full min-w-0">
            {isCompleting && (
              <div className="px-4 pt-4 lg:px-6">
                <Card>
                  <CardContent className="py-4">
                    <HStack className="justify-between">
                      <span className="text-sm">
                        <Trans>
                          A previous completion did not finish. Retrying resumes
                          the remaining steps — quantities are not
                          double-counted.
                        </Trans>
                      </span>
                      <Badge variant="yellow">
                        <Trans>Completing</Trans>
                      </Badge>
                    </HStack>
                  </CardContent>
                </Card>
              </div>
            )}
            {scope === "job" && batch && (
              <div className="px-4 pt-4 lg:px-6">
                <Alert>
                  <LuLayers />
                  <AlertTitle>
                    <Trans>
                      {operation.jobReadableId} runs in batch {batch.readableId}
                    </Trans>
                  </AlertTitle>
                  <AlertDescription>
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                      <span className="text-pretty">
                        <Trans>
                          The timer and completion are shared by all{" "}
                          {(batch.operations ?? []).length} jobs. Steps,
                          materials and files here are this job's own.
                        </Trans>
                      </span>
                      <Button
                        variant="secondary"
                        leftIcon={<LuChevronLeft />}
                        onClick={() => setParams({ scope: "" })}
                      >
                        <Trans>Back to batch</Trans>
                      </Button>
                    </div>
                  </AlertDescription>
                </Alert>
              </div>
            )}
            {scope === "batch" && batch ? (
              <Suspense
                key={`batch-overview-${operationId}`}
                fallback={<TableSkeleton />}
              >
                <Await resolve={materials}>
                  {(resolvedMaterials) => (
                    <>
                      <BatchOverview
                        batch={batch}
                        totals={batchMaterialTotals ?? {}}
                        currentMaterials={resolvedMaterials?.materials ?? []}
                        onIssue={(material) => {
                          flushSync(() => {
                            setSelectedMaterial(material);
                          });
                          issueModal.onOpen();
                        }}
                        workInstructions={batchWorkInstructions}
                        onDownloadFile={downloadFile}
                      />
                      {renderIssueModal(resolvedMaterials)}
                    </>
                  )}
                </Await>
              </Suspense>
            ) : (
              <>
                <div className="flex items-start justify-between gap-4 p-4 lg:p-6">
                  <HStack className="min-w-0">
                    {thumbnailPath && (
                      <ItemThumbnail thumbnailPath={thumbnailPath} size="xl" />
                    )}
                    <div className="flex flex-col flex-grow min-w-0">
                      <HStack spacing={2}>
                        <Heading size="h3" className="line-clamp-1">
                          {operation.description}
                        </Heading>
                        {operation.reworkId && (
                          <Badge variant="red">Rework</Badge>
                        )}
                      </HStack>
                      <p className="text-muted-foreground line-clamp-1">
                        {operation.itemReadableId}
                      </p>
                    </div>
                  </HStack>
                  <div className="flex flex-col shrink-0 items-end">
                    <Heading size="h2">
                      {formatDurationMilliseconds(
                        ((progress.setup ?? 0) +
                          (progress.labor ?? 0) +
                          (progress.machine ?? 0)) /
                          // Batch mode: the timer is shared, so the per-piece rate
                          // is elapsed over ALL members' completed parts — a
                          // quantity-weighted average, matching how completion
                          // slices the shared time (weight = operationQuantity).
                          Math.max(
                            batch
                              ? (batch.operations ?? []).reduce(
                                  (sum, m) => sum + (m.quantityComplete ?? 0),
                                  0
                                )
                              : operation.quantityComplete,
                            1
                          ),
                        {
                          style: "short"
                        }
                      )}
                    </Heading>
                    <p className="text-muted-foreground line-clamp-1">
                      {operation.itemUnitOfMeasure}
                    </p>
                  </div>
                </div>
                <Separator />
                <div className="flex items-start p-4 lg:p-6">
                  <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 w-full min-w-0">
                    <Card>
                      <CardHeader className="flex flex-row items-center gap-2 justify-between">
                        <CardTitle>
                          <Trans>Completed</Trans>
                        </CardTitle>
                        <FaCheck className="h-3 w-3 text-emerald-500" />
                      </CardHeader>

                      <CardContent>
                        <Heading size="h1">
                          <Trans>
                            {operation.quantityComplete} of{" "}
                            {operation.targetQuantity}
                          </Trans>
                        </Heading>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="flex flex-row items-center gap-2 justify-between">
                        <CardTitle>
                          <Trans>Scrapped</Trans>
                        </CardTitle>
                        <FaTrash className="h-3 w-3 text-muted-foreground" />
                      </CardHeader>
                      <CardContent>
                        <Heading size="h1">
                          {operation.quantityScrapped}
                        </Heading>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader className="flex flex-row items-center gap-2 justify-between">
                        <CardTitle>
                          <Trans>Due Date</Trans>
                        </CardTitle>
                        <DeadlineIcon
                          deadlineType={operation.jobDeadlineType}
                          overdue={isOverdue}
                        />
                      </CardHeader>
                      <CardContent>
                        <VStack className="justify-start" spacing={0}>
                          <Heading
                            size="h3"
                            className={cn(
                              "w-full truncate",
                              isOverdue ? "text-red-500" : ""
                            )}
                          >
                            {["ASAP", "No Deadline"].includes(
                              operation.jobDeadlineType
                            )
                              ? operation.jobDeadlineType
                              : operation.operationDueDate
                                ? t`Due ${formatRelativeTime(
                                    convertDateStringToIsoString(
                                      operation.operationDueDate
                                    )
                                  )}`
                                : "–"}
                          </Heading>
                          <span className="text-muted-foreground text-sm">
                            {operation.operationDueDate ? (
                              <DateTime
                                value={operation.operationDueDate}
                                variant="date"
                              />
                            ) : null}
                          </span>
                          {projectedCompletionDate &&
                            (isBehindTarget ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="red">
                                    {t`Proj. ${formatDate(
                                      projectedCompletionDate
                                    )}`}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {t`Behind target by ${daysBehindTarget} day(s)`}
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <span className="text-sm text-muted-foreground">
                                {t`Proj. ${formatDate(projectedCompletionDate)}`}
                              </span>
                            ))}
                        </VStack>
                      </CardContent>
                    </Card>
                  </div>
                </div>

                <Suspense key={`non-conformance-actions-${operationId}`}>
                  <Await resolve={nonConformanceActions}>
                    {(resolvedNonConformanceActions) => {
                      return resolvedNonConformanceActions.map((action) => {
                        if (Object.keys(action.notes).length === 0) {
                          return null;
                        }

                        return (
                          <>
                            <Separator />
                            <div className="flex flex-col items-start justify-between w-full">
                              <div className="flex flex-col gap-4 p-4 lg:p-6 w-full">
                                <div className="flex flex-col gap-0.5">
                                  <Heading size="h3">
                                    {action.actionTypeName}
                                  </Heading>
                                  <div>
                                    <Badge variant="outline">
                                      {action.nonConformanceId}
                                    </Badge>
                                  </div>
                                </div>
                                <div
                                  className="prose dark:prose-invert prose-sm max-w-none"
                                  dangerouslySetInnerHTML={{
                                    __html: generateHTML(action.notes)
                                  }}
                                />
                              </div>
                            </div>
                          </>
                        );
                      });
                    }}
                  </Await>
                </Suspense>

                <Suspense key={`attributes-${operationId}`}>
                  <Await resolve={procedure}>
                    {(resolvedProcedure) => {
                      const { attributes, parameters } = resolvedProcedure;

                      return (
                        <>
                          {attributes.length > 0 && (
                            <>
                              <Separator />
                              <div className="flex flex-col items-start justify-between w-full">
                                <div className="flex flex-col gap-4 p-4 lg:p-6 w-full">
                                  <HStack className="justify-between w-full">
                                    <Heading size="h3">
                                      <Trans>Steps</Trans>
                                    </Heading>
                                    <div className="flex items-center gap-2">
                                      {attributes.length > 0 &&
                                        (() => {
                                          const maxRecords = parentIsSerial
                                            ? trackedEntities.length
                                            : operation.operationQuantity +
                                              operation.quantityScrapped;

                                          const isRecordSetStarted =
                                            recordSetIsStarted(
                                              attributes,
                                              activeStep
                                            );

                                          const canCreateNewRecord =
                                            !parentIsSerial &&
                                            isRecordSetStarted;

                                          const canNavigateNext =
                                            isRecordSetStarted &&
                                            activeStep <
                                              operation.operationQuantity +
                                                operation.quantityScrapped -
                                                1;

                                          const showNavigation =
                                            hasMultipleRecords ||
                                            attributes.some(
                                              (att) =>
                                                att.jobOperationStepRecord
                                                  .length > 1
                                            );

                                          return (
                                            <div className="flex flex-col items-end justify-center gap-2">
                                              <div className="flex items-center gap-1">
                                                {showNavigation &&
                                                  !parentIsSerial && (
                                                    <>
                                                      <IconButton
                                                        aria-label="Previous record set"
                                                        variant="secondary"
                                                        icon={<LuChevronLeft />}
                                                        onClick={() => {
                                                          setActiveStep(
                                                            activeStep - 1
                                                          );
                                                        }}
                                                        isDisabled={
                                                          activeStep === 0
                                                        }
                                                      />
                                                      <span className="text-sm font-medium px-2 min-w-[60px] text-center">
                                                        <Trans>
                                                          Record{" "}
                                                          {activeStep + 1}
                                                        </Trans>
                                                      </span>
                                                      <IconButton
                                                        aria-label="Next record set"
                                                        variant="secondary"
                                                        icon={
                                                          <LuChevronRight />
                                                        }
                                                        onClick={() => {
                                                          setActiveStep(
                                                            activeStep + 1
                                                          );
                                                        }}
                                                        isDisabled={
                                                          !canNavigateNext
                                                        }
                                                      />
                                                    </>
                                                  )}
                                                {canCreateNewRecord &&
                                                  !showNavigation && (
                                                    <Button
                                                      aria-label="Add new record set"
                                                      variant="secondary"
                                                      leftIcon={
                                                        <LuCirclePlus />
                                                      }
                                                      onClick={() => {
                                                        const nextIndex =
                                                          activeStep + 1;
                                                        if (
                                                          nextIndex >=
                                                          maxRecords
                                                        ) {
                                                          toast.warning(
                                                            t`Maximum number of records reached`
                                                          );
                                                          return;
                                                        }
                                                        setHasMultipleRecords(
                                                          true
                                                        );
                                                        setActiveStep(
                                                          nextIndex
                                                        );
                                                      }}
                                                      isDisabled={
                                                        activeStep + 1 >=
                                                        maxRecords
                                                      }
                                                    >
                                                      <Trans>New Record</Trans>
                                                    </Button>
                                                  )}
                                                {parentIsSerial && (
                                                  <Heading size="h2">
                                                    <Trans>
                                                      {serialIndex + 1} of{" "}
                                                      {
                                                        operation.operationQuantity
                                                      }
                                                    </Trans>
                                                  </Heading>
                                                )}
                                              </div>

                                              <BarProgress
                                                label={t`Steps`}
                                                gradient
                                                invertGradient
                                                progress={
                                                  (attributes.filter((a) =>
                                                    a.jobOperationStepRecord.some(
                                                      (r) =>
                                                        r.index === activeStep
                                                    )
                                                  ).length /
                                                    attributes.length) *
                                                  100
                                                }
                                              />
                                              <span className="text-xs text-muted-foreground">
                                                <Trans>
                                                  {
                                                    attributes.filter((a) =>
                                                      a.jobOperationStepRecord.some(
                                                        (r) =>
                                                          r.index === activeStep
                                                      )
                                                    ).length
                                                  }{" "}
                                                  of {attributes.length}{" "}
                                                  complete
                                                </Trans>
                                              </span>
                                            </div>
                                          );
                                        })()}
                                    </div>
                                  </HStack>
                                  <div className="border rounded-lg">
                                    {attributes
                                      .sort(
                                        (a, b) =>
                                          (a.sortOrder ?? 0) -
                                          (b.sortOrder ?? 0)
                                      )
                                      .map((step, index) => (
                                        <StepsListItem
                                          key={`step-${step.id}`}
                                          activeStep={activeStep}
                                          step={step}
                                          onRecord={onRecordStepRecord}
                                          onDelete={onDeleteStepRecord}
                                          operationId={operationId}
                                          className={
                                            index === attributes.length - 1
                                              ? "border-none"
                                              : ""
                                          }
                                        />
                                      ))}
                                  </div>
                                </div>
                              </div>
                            </>
                          )}
                          {parameters.length > 0 && (
                            <>
                              <Separator />
                              <div className="flex flex-col items-start justify-between w-full">
                                <div className="flex flex-col gap-4 p-4 lg:p-6 w-full">
                                  <HStack className="justify-between w-full">
                                    <Heading size="h3">
                                      <Trans>Process Parameters</Trans>
                                    </Heading>
                                  </HStack>
                                  <div className="border rounded-lg">
                                    {parameters
                                      .sort((a, b) =>
                                        (a.key ?? "").localeCompare(b.key ?? "")
                                      )
                                      .map((p, index) => (
                                        <ParametersListItem
                                          key={`parameter-${p.id}`}
                                          parameter={p}
                                          operationId={operationId}
                                          className={
                                            index === parameters.length - 1
                                              ? "border-none"
                                              : ""
                                          }
                                        />
                                      ))}
                                  </div>
                                </div>
                              </div>
                            </>
                          )}
                        </>
                      );
                    }}
                  </Await>
                </Suspense>

                <Separator />
                <div className="flex flex-col items-start justify-between w-full">
                  <div className="flex flex-col gap-4 p-4 lg:p-6 w-full">
                    <HStack className="justify-between w-full">
                      <Heading size="h3">
                        <Trans>Materials</Trans>
                      </Heading>
                      <Button
                        aria-label="Issue Material"
                        leftIcon={<LuGitBranchPlus />}
                        variant="secondary"
                        size="lg"
                        onClick={() => {
                          flushSync(() => {
                            setSelectedMaterial(null);
                          });
                          issueModal.onOpen();
                        }}
                      >
                        <Trans>Issue Material</Trans>
                      </Button>
                    </HStack>
                    <Suspense
                      key={`materials-${operationId}`}
                      fallback={<TableSkeleton />}
                    >
                      <Await resolve={materials}>
                        {(resolvedMaterials) => {
                          const baseMaterials =
                            resolvedMaterials?.materials.filter(
                              (m) => !m.isKitComponent
                            );

                          const kitMaterialsByParentId =
                            resolvedMaterials?.materials
                              .filter((m) => m.isKitComponent ?? false)
                              .reduce(
                                (acc, material) => {
                                  if (material.kitParentId) {
                                    if (!acc[material.kitParentId]) {
                                      acc[material.kitParentId] = [];
                                    }
                                    acc[material.kitParentId].push(material);
                                  }
                                  return acc;
                                },
                                {} as Record<string, JobMaterial[]>
                              );

                          return (
                            <>
                              <div className="w-full overflow-hidden rounded-lg border bg-card">
                                <Table className="w-full text-base">
                                  <Thead className="bg-muted/40">
                                    <Tr>
                                      <Th className="text-sm">
                                        <Trans>Part</Trans>
                                      </Th>
                                      <Th className="text-sm lg:table-cell hidden">
                                        <Trans>Source</Trans>
                                      </Th>
                                      <Th className="text-sm">
                                        <Trans>Estimated</Trans>
                                      </Th>
                                      <Th className="text-sm">
                                        <Trans>Actual</Trans>
                                      </Th>
                                      <Th className="text-right" />
                                    </Tr>
                                  </Thead>
                                  <Tbody className="[&>tr]:border-b [&>tr:last-child]:border-0">
                                    {baseMaterials.length === 0 ? (
                                      <Tr>
                                        <Td
                                          colSpan={24}
                                          className="py-8 text-muted-foreground text-center"
                                        >
                                          <Trans>No materials</Trans>
                                        </Td>
                                      </Tr>
                                    ) : (
                                      baseMaterials.map((material) => {
                                        const isRelatedToOperation =
                                          material.jobOperationId ===
                                          operationId;

                                        const someRelatedMaterialIsIssued =
                                          baseMaterials.some(
                                            (m) =>
                                              m.itemReadableIdWithoutRevision ===
                                                material.itemReadableIdWithoutRevision &&
                                              ((m.quantityIssued ?? 0) > 0 ||
                                                (material.quantityIssued ?? 0) >
                                                  0)
                                          );

                                        const kittedChildren = material.id
                                          ? kitMaterialsByParentId[material.id]
                                          : [];

                                        return (
                                          <>
                                            <Tr
                                              key={`material-${material.id}`}
                                              className={cn(
                                                "[&>td]:py-3",
                                                !isRelatedToOperation &&
                                                  "opacity-50 hover:opacity-100"
                                              )}
                                            >
                                              <Td className="max-w-[20vw]">
                                                <HStack
                                                  spacing={2}
                                                  className="justify-between min-w-0"
                                                >
                                                  <VStack
                                                    spacing={0}
                                                    className="min-w-0"
                                                  >
                                                    <span className="font-semibold text-base truncate max-w-full">
                                                      {getItemReadableId(
                                                        items,
                                                        material.itemId ?? ""
                                                      )}
                                                    </span>
                                                    <span className="text-muted-foreground text-sm truncate max-w-full">
                                                      {material.description}
                                                    </span>
                                                    <PickedBreakdown
                                                      materialItemId={
                                                        material.itemId
                                                      }
                                                      pickedByItem={
                                                        (
                                                          material as {
                                                            pickedByItem?: {
                                                              itemId: string;
                                                              itemReadableId: string;
                                                              quantityPicked: number;
                                                              quantityToPick: number;
                                                            }[];
                                                          }
                                                        ).pickedByItem
                                                      }
                                                    />
                                                  </VStack>
                                                  {material.requiresBatchTracking ? (
                                                    <Badge variant="secondary">
                                                      <TrackingTypeIcon
                                                        type="Batch"
                                                        className="shrink-0"
                                                      />
                                                    </Badge>
                                                  ) : material.requiresSerialTracking ? (
                                                    <Badge variant="secondary">
                                                      <TrackingTypeIcon
                                                        type="Serial"
                                                        className="shrink-0"
                                                      />
                                                    </Badge>
                                                  ) : null}
                                                  {(
                                                    material as {
                                                      hasExpiredConsumed?: boolean;
                                                    }
                                                  ).hasExpiredConsumed && (
                                                    <Badge
                                                      variant="red"
                                                      className="gap-1 shrink-0"
                                                      title="A consumed batch or serial is now past its expiry date."
                                                    >
                                                      <LuTriangleAlert className="size-3" />
                                                      <Trans>
                                                        Consumed expired
                                                      </Trans>
                                                    </Badge>
                                                  )}
                                                  <PickedBadge
                                                    quantityPicked={
                                                      (
                                                        material as {
                                                          quantityPicked?:
                                                            | number
                                                            | null;
                                                        }
                                                      ).quantityPicked
                                                    }
                                                    quantityToPick={
                                                      (
                                                        material as {
                                                          quantityToPick?:
                                                            | number
                                                            | null;
                                                        }
                                                      ).quantityToPick
                                                    }
                                                  />
                                                </HStack>
                                              </Td>
                                              <Td className="hidden lg:table-cell">
                                                <div className="flex flex-row items-center gap-1">
                                                  <Badge variant="secondary">
                                                    <MethodIcon
                                                      type={
                                                        material.methodType ??
                                                        ""
                                                      }
                                                      isKit={
                                                        material.kit ?? false
                                                      }
                                                      className="mr-2"
                                                    />
                                                    {material.methodType ===
                                                      "Make to Order" &&
                                                    material.kit
                                                      ? t`Kit`
                                                      : material.methodType}
                                                  </Badge>
                                                  <LuArrowLeft
                                                    className={cn(
                                                      material.methodType ===
                                                        "Make to Order"
                                                        ? "rotate-180"
                                                        : ""
                                                    )}
                                                  />
                                                  <Badge variant="secondary">
                                                    <LuGitPullRequest className="size-3 mr-1" />
                                                    {material.storageUnitName ??
                                                      (material.methodType ===
                                                      "Make to Order"
                                                        ? t`WIP`
                                                        : t`Default Storage Unit`)}
                                                  </Badge>
                                                </div>
                                              </Td>

                                              <Td>
                                                {parentIsSerial &&
                                                (material.requiresBatchTracking ||
                                                  material.requiresSerialTracking)
                                                  ? `${
                                                      material.quantity ??
                                                      material.estimatedQuantity
                                                    }/${
                                                      material.estimatedQuantity ??
                                                      material.quantity
                                                    }`
                                                  : (material.estimatedQuantity ??
                                                    material.quantity)}
                                                {isBatched &&
                                                  material.itemId &&
                                                  batchMaterialTotals?.[
                                                    material.itemId
                                                  ] && (
                                                    <div className="text-xs text-muted-foreground whitespace-nowrap">
                                                      <Trans>Batch</Trans>:{" "}
                                                      {
                                                        batchMaterialTotals[
                                                          material.itemId
                                                        ].required
                                                      }
                                                    </div>
                                                  )}
                                              </Td>
                                              <Td>
                                                {material.methodType ===
                                                  "Make to Order" &&
                                                material.requiresBatchTracking ===
                                                  false &&
                                                material.requiresSerialTracking ===
                                                  false ? (
                                                  <MethodIcon
                                                    type="Make to Order"
                                                    isKit={
                                                      material.kit ?? false
                                                    }
                                                  />
                                                ) : parentIsSerial &&
                                                  (material.requiresBatchTracking ||
                                                    material.requiresSerialTracking) ? (
                                                  `${material.quantityIssued}/${
                                                    material.quantity ??
                                                    material.estimatedQuantity
                                                  }`
                                                ) : (
                                                  material.quantityIssued
                                                )}
                                                {isBatched &&
                                                  material.itemId &&
                                                  batchMaterialTotals?.[
                                                    material.itemId
                                                  ] && (
                                                    <div className="text-xs text-muted-foreground whitespace-nowrap">
                                                      <Trans>Batch</Trans>:{" "}
                                                      {
                                                        batchMaterialTotals[
                                                          material.itemId
                                                        ].issued
                                                      }
                                                    </div>
                                                  )}
                                              </Td>
                                              <Td className="text-right">
                                                {material.methodType !==
                                                  "Make to Order" &&
                                                  material.requiresBatchTracking ===
                                                    false &&
                                                  material.requiresSerialTracking ===
                                                    false && (
                                                    <IconButton
                                                      aria-label="Issue Material"
                                                      variant="ghost"
                                                      icon={<LuGitBranchPlus />}
                                                      className="h-8 w-8"
                                                      onClick={() => {
                                                        flushSync(() => {
                                                          setSelectedMaterial(
                                                            material
                                                          );
                                                        });
                                                        issueModal.onOpen();
                                                      }}
                                                    />
                                                  )}
                                                {(material.requiresBatchTracking ||
                                                  material.requiresSerialTracking) && (
                                                  <Button
                                                    className="flex-shrink-0"
                                                    size="lg"
                                                    variant={
                                                      someRelatedMaterialIsIssued ||
                                                      !isRelatedToOperation
                                                        ? "secondary"
                                                        : "primary"
                                                    }
                                                    leftIcon={<LuQrCode />}
                                                    onClick={() => {
                                                      flushSync(() => {
                                                        setSelectedMaterial(
                                                          material
                                                        );
                                                      });
                                                      issueModal.onOpen();
                                                    }}
                                                  >
                                                    <Trans>Issue</Trans>
                                                  </Button>
                                                )}
                                              </Td>
                                            </Tr>

                                            {kittedChildren &&
                                              kittedChildren.map(
                                                (kittedChild, index) => (
                                                  <Tr
                                                    key={`kittedChild-${kittedChild.id}`}
                                                    className={cn(
                                                      index ===
                                                        kittedChildren.length -
                                                          1
                                                        ? "border-b"
                                                        : index === 0
                                                          ? "border-t"
                                                          : "",
                                                      !isRelatedToOperation &&
                                                        "opacity-50 hover:opacity-100"
                                                    )}
                                                  >
                                                    <Td className="pl-10 max-w-[20vw]">
                                                      <HStack
                                                        spacing={2}
                                                        className="justify-between min-w-0"
                                                      >
                                                        <VStack
                                                          spacing={0}
                                                          className="min-w-0"
                                                        >
                                                          <span className="font-semibold truncate max-w-full">
                                                            {getItemReadableId(
                                                              items,
                                                              kittedChild.itemId
                                                            )}
                                                          </span>
                                                          <span className="text-muted-foreground text-xs truncate max-w-full">
                                                            {
                                                              kittedChild.description
                                                            }
                                                          </span>
                                                          <PickedBreakdown
                                                            materialItemId={
                                                              kittedChild.itemId
                                                            }
                                                            pickedByItem={
                                                              (
                                                                kittedChild as {
                                                                  pickedByItem?: {
                                                                    itemId: string;
                                                                    itemReadableId: string;
                                                                    quantityPicked: number;
                                                                    quantityToPick: number;
                                                                  }[];
                                                                }
                                                              ).pickedByItem
                                                            }
                                                          />
                                                        </VStack>
                                                        {kittedChild.requiresBatchTracking ? (
                                                          <Badge variant="secondary">
                                                            <TrackingTypeIcon
                                                              type="Batch"
                                                              className="shrink-0"
                                                            />
                                                          </Badge>
                                                        ) : kittedChild.requiresSerialTracking ? (
                                                          <Badge variant="secondary">
                                                            <TrackingTypeIcon
                                                              type="Serial"
                                                              className="shrink-0"
                                                            />
                                                          </Badge>
                                                        ) : null}
                                                        <PickedBadge
                                                          quantityPicked={
                                                            (
                                                              kittedChild as {
                                                                quantityPicked?:
                                                                  | number
                                                                  | null;
                                                              }
                                                            ).quantityPicked
                                                          }
                                                          quantityToPick={
                                                            (
                                                              kittedChild as {
                                                                quantityToPick?:
                                                                  | number
                                                                  | null;
                                                              }
                                                            ).quantityToPick
                                                          }
                                                        />
                                                      </HStack>
                                                    </Td>
                                                    <Td className="lg:table-cell hidden">
                                                      <Badge variant="secondary">
                                                        <MethodIcon
                                                          type={
                                                            kittedChild.methodType ??
                                                            ""
                                                          }
                                                          isKit={
                                                            kittedChild.kit ??
                                                            false
                                                          }
                                                          className="mr-2"
                                                        />
                                                        {kittedChild.methodType ===
                                                          "Make to Order" &&
                                                        kittedChild.kit
                                                          ? t`Kit`
                                                          : kittedChild.methodType}
                                                      </Badge>
                                                    </Td>

                                                    <Td>
                                                      {parentIsSerial &&
                                                      (kittedChild.requiresBatchTracking ||
                                                        kittedChild.requiresSerialTracking)
                                                        ? `${
                                                            kittedChild.quantity ??
                                                            kittedChild.estimatedQuantity
                                                          }/${
                                                            kittedChild.estimatedQuantity ??
                                                            kittedChild.quantity
                                                          }`
                                                        : (kittedChild.estimatedQuantity ??
                                                          kittedChild.quantity)}
                                                    </Td>
                                                    <Td>
                                                      {kittedChild.methodType ===
                                                        "Make to Order" &&
                                                      kittedChild.requiresBatchTracking ===
                                                        false &&
                                                      kittedChild.requiresSerialTracking ===
                                                        false ? (
                                                        <MethodIcon
                                                          type="Make to Order"
                                                          isKit={
                                                            kittedChild.kit ??
                                                            false
                                                          }
                                                        />
                                                      ) : parentIsSerial &&
                                                        (kittedChild.requiresBatchTracking ||
                                                          kittedChild.requiresSerialTracking) ? (
                                                        `${
                                                          kittedChild.quantityIssued
                                                        }/${
                                                          kittedChild.quantity ??
                                                          kittedChild.estimatedQuantity
                                                        }`
                                                      ) : (
                                                        kittedChild.quantityIssued
                                                      )}
                                                    </Td>
                                                    <Td className="text-right">
                                                      {kittedChild.methodType !==
                                                        "Make to Order" &&
                                                        kittedChild.requiresBatchTracking ===
                                                          false &&
                                                        kittedChild.requiresSerialTracking ===
                                                          false && (
                                                          <IconButton
                                                            aria-label="Issue Material"
                                                            variant="ghost"
                                                            icon={
                                                              <LuGitBranchPlus />
                                                            }
                                                            className="h-8 w-8"
                                                            onClick={() => {
                                                              flushSync(() => {
                                                                setSelectedMaterial(
                                                                  kittedChild
                                                                );
                                                              });
                                                              issueModal.onOpen();
                                                            }}
                                                          />
                                                        )}
                                                      {(kittedChild.requiresBatchTracking ||
                                                        kittedChild.requiresSerialTracking) && (
                                                        <IconButton
                                                          aria-label="Issue Material"
                                                          variant="secondary"
                                                          icon={<LuQrCode />}
                                                          className="h-8 w-8"
                                                          onClick={() => {
                                                            flushSync(() => {
                                                              setSelectedMaterial(
                                                                kittedChild
                                                              );
                                                            });
                                                            issueModal.onOpen();
                                                          }}
                                                        />
                                                      )}
                                                    </Td>
                                                  </Tr>
                                                )
                                              )}
                                          </>
                                        );
                                      })
                                    )}
                                  </Tbody>
                                </Table>
                              </div>
                              {renderIssueModal(resolvedMaterials)}
                            </>
                          );
                        }}
                      </Await>
                    </Suspense>
                  </div>
                </div>

                <Separator />
                <div className="flex flex-col items-start justify-between w-full">
                  <div className="flex flex-col gap-4 p-4 lg:p-6 w-full">
                    <Heading size="h3">
                      <Trans>Files</Trans>
                    </Heading>
                    <p className="text-muted-foreground text-sm -mt-2">
                      <Trans>
                        Files related to the job and the opportunity line.
                      </Trans>
                    </p>
                    <Suspense
                      key={`files-${operationId}`}
                      fallback={<TableSkeleton />}
                    >
                      <Await resolve={files}>
                        {(resolvedFiles) => (
                          <div className="w-full overflow-hidden rounded-lg border bg-card">
                            <Table className="w-full text-base">
                              <Thead className="bg-muted/40">
                                <Tr>
                                  <Th className="text-sm">
                                    <Trans>Name</Trans>
                                  </Th>
                                  <Th className="text-sm">
                                    <Trans>Size</Trans>
                                  </Th>
                                  <Th></Th>
                                </Tr>
                              </Thead>
                              <Tbody className="[&>tr]:border-b [&>tr:last-child]:border-0">
                                {resolvedFiles.length === 0 && !modelUpload ? (
                                  <Tr>
                                    <Td
                                      colSpan={24}
                                      className="py-8 text-muted-foreground text-center"
                                    >
                                      <Trans>No files</Trans>
                                    </Td>
                                  </Tr>
                                ) : (
                                  <>
                                    {modelUpload?.modelName && (
                                      <Tr className="[&>td]:py-3">
                                        <Td>
                                          <HStack>
                                            <LuAxis3D className="text-emerald-500 w-6 h-6" />
                                            <span>{modelUpload.modelName}</span>
                                          </HStack>
                                        </Td>
                                        <Td className="text-sm font-mono">
                                          {modelUpload.modelSize
                                            ? convertKbToString(
                                                Math.floor(
                                                  (modelUpload.modelSize ?? 0) /
                                                    1024
                                                )
                                              )
                                            : "--"}
                                        </Td>
                                        <Td>
                                          <div className="flex justify-end w-full">
                                            <DropdownMenu>
                                              <DropdownMenuTrigger asChild>
                                                <IconButton
                                                  aria-label="More"
                                                  icon={<LuEllipsisVertical />}
                                                  variant="secondary"
                                                />
                                              </DropdownMenuTrigger>
                                              <DropdownMenuContent align="end">
                                                <DropdownMenuItem
                                                  onClick={() =>
                                                    downloadModel(modelUpload)
                                                  }
                                                >
                                                  <DropdownMenuIcon
                                                    icon={<LuDownload />}
                                                  />
                                                  <Trans>Download</Trans>
                                                </DropdownMenuItem>
                                              </DropdownMenuContent>
                                            </DropdownMenu>
                                          </div>
                                        </Td>
                                      </Tr>
                                    )}
                                    {resolvedFiles.map((file) => {
                                      const type = getFileType(file.name);
                                      return (
                                        <Tr
                                          key={`file-${file.id}`}
                                          className="[&>td]:py-3"
                                        >
                                          <Td>
                                            <HStack>
                                              <FileIcon type={type} />
                                              <span
                                                className="font-medium"
                                                onClick={() => {
                                                  if (
                                                    ["PDF", "Image"].includes(
                                                      type
                                                    )
                                                  ) {
                                                    window.open(
                                                      path.to.file.previewFile(
                                                        `${"private"}/${getFilePath(
                                                          file
                                                        )}`
                                                      ),
                                                      "_blank"
                                                    );
                                                  }
                                                }}
                                              >
                                                {["PDF", "Image"].includes(
                                                  type
                                                ) ? (
                                                  <FilePreview
                                                    bucket="private"
                                                    pathToFile={getFilePath(
                                                      file
                                                    )}
                                                    // @ts-ignore
                                                    type={getFileType(
                                                      file.name
                                                    )}
                                                  >
                                                    {file.name}
                                                  </FilePreview>
                                                ) : (
                                                  file.name
                                                )}
                                              </span>
                                            </HStack>
                                          </Td>
                                          <Td className="text-sm font-mono">
                                            {convertKbToString(
                                              Math.floor(
                                                (file.metadata?.size ?? 0) /
                                                  1024
                                              )
                                            )}
                                          </Td>
                                          <Td>
                                            <div className="flex justify-end w-full">
                                              <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                  <IconButton
                                                    aria-label="More"
                                                    icon={
                                                      <LuEllipsisVertical />
                                                    }
                                                    variant="secondary"
                                                  />
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                  <DropdownMenuItem
                                                    onClick={() =>
                                                      downloadFile(file)
                                                    }
                                                  >
                                                    <DropdownMenuIcon
                                                      icon={<LuDownload />}
                                                    />
                                                    Download
                                                  </DropdownMenuItem>
                                                </DropdownMenuContent>
                                              </DropdownMenu>
                                            </div>
                                          </Td>
                                        </Tr>
                                      );
                                    })}
                                  </>
                                )}
                              </Tbody>
                            </Table>
                          </div>
                        )}
                      </Await>
                    </Suspense>
                  </div>
                </div>

                {parentIsSerial && (
                  <>
                    <Separator />
                    <div className="flex flex-col items-start justify-between w-full">
                      <div className="flex flex-col gap-4 p-4 lg:p-6 w-full">
                        <HStack className="justify-between w-full">
                          <Heading size="h3">
                            <Trans>Serial Numbers</Trans>
                          </Heading>
                          {trackedEntities?.length > 0 && (
                            <HStack>
                              <PrintButton
                                sourceDocument="Operation"
                                sourceDocumentId={operationId!}
                                locationId={locationId}
                                context="workCenter"
                                workCenterId={
                                  operation.workCenterId ?? undefined
                                }
                                size="lg"
                                fileRoutes={{
                                  pdf: path.to.file.operationLabelsPdf,
                                  zpl: path.to.file.operationLabelsZpl
                                }}
                              />
                              <Button
                                variant="secondary"
                                size="lg"
                                leftIcon={<LuBarcode />}
                                onClick={serialModal.onOpen}
                              >
                                <Trans>Scan</Trans>
                              </Button>
                            </HStack>
                          )}
                        </HStack>

                        <div className="w-full overflow-hidden rounded-lg border bg-card">
                          <Table className="w-full text-base">
                            <Thead className="bg-muted/40">
                              <Tr>
                                <Th className="text-sm">
                                  <Trans>Serial</Trans>
                                </Th>
                                <Th className="text-right" />
                              </Tr>
                            </Thead>
                            <Tbody className="[&>tr]:border-b [&>tr:last-child]:border-0">
                              {trackedEntities?.length === 0 ? (
                                <Tr>
                                  <Td
                                    colSpan={24}
                                    className="py-8 text-muted-foreground text-center"
                                  >
                                    <LuTriangleAlert className="text-red-500 size-4" />
                                    <Trans>No serial numbers</Trans>
                                  </Td>
                                </Tr>
                              ) : (
                                trackedEntities?.map((entity) => (
                                  <Tr
                                    key={`serial-${entity.id}`}
                                    className={cn(
                                      "[&>td]:py-3",
                                      entity.status === "Scrapped" &&
                                        "opacity-60"
                                    )}
                                  >
                                    <Td>
                                      <div className="flex gap-2 items-center">
                                        <div className="flex flex-col min-w-0">
                                          {entity.readableId ? (
                                            <>
                                              <span className="font-medium truncate">
                                                {entity.readableId}
                                              </span>
                                              <span className="text-xs text-muted-foreground font-mono truncate">
                                                {entity.id}
                                              </span>
                                            </>
                                          ) : (
                                            <span className="font-mono truncate">
                                              {entity.id}
                                            </span>
                                          )}
                                        </div>
                                        {entity.id === trackedEntityId && (
                                          <LuCheck className="text-emerald-500 size-4 shrink-0" />
                                        )}
                                        <Copy
                                          text={entity.readableId || entity.id}
                                        />
                                        {entity.status === "Scrapped" && (
                                          <Badge variant="red">
                                            <Trans>Scrapped</Trans>
                                          </Badge>
                                        )}
                                      </div>
                                    </Td>

                                    <Td className="text-right">
                                      <div className="flex justify-end gap-2">
                                        <PrintButton
                                          sourceDocument="Entity"
                                          sourceDocumentId={entity.id}
                                          locationId={locationId}
                                          context="workCenter"
                                          workCenterId={
                                            operation.workCenterId ?? undefined
                                          }
                                          size="lg"
                                          fileRoutes={{
                                            pdf: path.to.file
                                              .trackedEntityLabelPdf,
                                            zpl: path.to.file
                                              .trackedEntityLabelZpl
                                          }}
                                        />
                                        <Button
                                          variant="secondary"
                                          size="lg"
                                          isDisabled={
                                            entity.id === trackedEntityId ||
                                            entity.status === "Scrapped"
                                          }
                                          onClick={() => {
                                            const entityIndex =
                                              trackedEntities.findIndex(
                                                (e) => e.id === entity.id
                                              );
                                            if (entityIndex !== -1) {
                                              setActiveStep(entityIndex);
                                            }
                                            setParams({
                                              trackedEntityId: entity.id
                                            });
                                          }}
                                        >
                                          <Trans>Select</Trans>
                                        </Button>
                                      </div>
                                    </Td>
                                  </Tr>
                                ))
                              )}
                            </Tbody>
                          </Table>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </TabsContent>
        <TabsContent
          value="model"
          className="[grid-area:main] mt-0 h-full min-h-0"
        >
          <div className="relative h-full w-full min-w-0 p-0">
            {modelPath ? (
              <ModelPreview
                key={modelPath}
                awaitingModel={modelPending}
                optimizing={backgroundOptimizing}
                optimizeFailed={optimizeFailed}
                sourceMissing={artifacts?.sourceAvailable === false}
                optimizedUrl={
                  artifacts?.optimizedModelPath
                    ? // ?v= busts the immutable preview cache on the STABLE
                      // optimized.glb path when a re-optimise lands.
                      `${getPrivateUrl(artifacts.optimizedModelPath)}${
                        artifacts.optimizedAt
                          ? `?v=${encodeURIComponent(artifacts.optimizedAt)}`
                          : ""
                      }`
                    : null
                }
                glbUrl={
                  artifacts?.glbPath ? getPrivateUrl(artifacts.glbPath) : null
                }
                lodUrl={
                  artifacts?.lodPath ? getPrivateUrl(artifacts.lodPath) : null
                }
                rawUrl={
                  artifacts?.rawPath &&
                  (artifacts.size ?? 0) <= MODEL_RAW_KEEP_MAX_BYTES
                    ? getRawModelUrl(artifacts.rawBucket, artifacts.rawPath)
                    : null
                }
                thumbnailUrl={
                  artifacts?.thumbnailPath
                    ? getPrivateUrl(artifacts.thumbnailPath)
                    : null
                }
                mode={mode}
                className="rounded-none"
                onRetry={canRetry ? onModelRetry : undefined}
                retryLabel={modelRetryLabel}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  No 3D model attached
                </p>
              </div>
            )}
            {showOptimizeProgress && (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/95 p-6">
                <OptimizeProgress
                  key={`${modelPath}:${artifacts?.optimizeStatus}`}
                  queued={optimizeQueued}
                  onCancel={onModelCancel}
                  cancelling={modelActionBusy}
                />
              </div>
            )}
          </div>
        </TabsContent>
        <TabsContent
          value="procedure"
          className="[grid-area:main] mt-0 flex h-full min-h-0"
        >
          {scope === "batch" && batch ? (
            <div className="h-full w-full overflow-y-auto scroll-fade scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
              <BatchOverview
                view="instructions"
                batch={batch}
                totals={batchMaterialTotals ?? {}}
                currentMaterials={[]}
                onIssue={() => {}}
                workInstructions={batchWorkInstructions}
                onDownloadFile={downloadFile}
              />
            </div>
          ) : (
            <div className="flex h-full w-full">
              <Suspense key={`procedure-${operationId}`}>
                <Await resolve={procedure}>
                  {(resolvedProcedure) => {
                    const { attributes, parameters } = resolvedProcedure;
                    if (attributes.length === 0 && parameters.length === 0)
                      return null;

                    return (
                      <ScrollArea className="hidden lg:block w-1/3 border-r shrink-0 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
                        <Tabs
                          defaultValue="attributes"
                          className="w-full flex-1 h-full flex flex-col"
                        >
                          <div className="w-full py-2 px-4 sticky top-0 z-10">
                            <TabsList className="w-full grid grid-cols-2">
                              <TabsTrigger value="attributes">
                                <Trans>Steps</Trans>
                              </TabsTrigger>
                              <TabsTrigger value="parameters">
                                <Trans>Parameters</Trans>
                              </TabsTrigger>
                            </TabsList>
                          </div>
                          <TabsContent
                            value="attributes"
                            className="w-full flex-1 flex flex-col overflow-y-auto data-[state=inactive]:hidden"
                          >
                            <VStack
                              className="w-full flex-1 overflow-y-auto scroll-fade scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
                              spacing={0}
                            >
                              {attributes.length > 0 &&
                                (() => {
                                  const maxRecords = parentIsSerial
                                    ? trackedEntities.length
                                    : operation.operationQuantity +
                                      operation.quantityScrapped;

                                  const isRecordSetStarted = recordSetIsStarted(
                                    attributes,
                                    activeStep
                                  );

                                  const canCreateNewRecord =
                                    !parentIsSerial && isRecordSetStarted;

                                  const canNavigateNext =
                                    isRecordSetStarted &&
                                    activeStep <
                                      operation.operationQuantity +
                                        operation.quantityScrapped -
                                        1;

                                  const showNavigation =
                                    hasMultipleRecords ||
                                    attributes.some(
                                      (att) =>
                                        att.jobOperationStepRecord.length > 1
                                    );

                                  return (
                                    <div className="flex items-end justify-between gap-1 w-full px-4 pb-2 border-b">
                                      <div className="flex items-center gap-1">
                                        {showNavigation && !parentIsSerial && (
                                          <>
                                            <IconButton
                                              aria-label="Previous record set"
                                              variant="secondary"
                                              icon={<LuChevronLeft />}
                                              onClick={() => {
                                                setActiveStep(activeStep - 1);
                                              }}
                                              isDisabled={activeStep === 0}
                                            />
                                            <span className="text-sm font-medium px-2 min-w-[60px] text-center">
                                              <Trans>
                                                Record {activeStep + 1}
                                              </Trans>
                                            </span>
                                            <IconButton
                                              aria-label="Next record set"
                                              variant="secondary"
                                              icon={<LuChevronRight />}
                                              onClick={() => {
                                                setActiveStep(activeStep + 1);
                                              }}
                                              isDisabled={!canNavigateNext}
                                            />
                                          </>
                                        )}
                                        {canCreateNewRecord &&
                                          !showNavigation && (
                                            <Button
                                              aria-label="Add new record set"
                                              variant="secondary"
                                              leftIcon={<LuCirclePlus />}
                                              onClick={() => {
                                                const nextIndex =
                                                  activeStep + 1;
                                                if (nextIndex >= maxRecords) {
                                                  toast.warning(
                                                    t`Maximum number of records reached`
                                                  );
                                                  return;
                                                }
                                                setHasMultipleRecords(true);
                                                setActiveStep(nextIndex);
                                              }}
                                              isDisabled={
                                                activeStep + 1 >= maxRecords
                                              }
                                            >
                                              <Trans>New Record</Trans>
                                            </Button>
                                          )}
                                        {parentIsSerial && (
                                          <Heading size="h2">
                                            <Trans>
                                              {serialIndex + 1} of{" "}
                                              {operation.operationQuantity}
                                            </Trans>
                                          </Heading>
                                        )}
                                      </div>

                                      <div className="flex flex-col justify-center items-end gap-1">
                                        <BarProgress
                                          label={t`Steps`}
                                          gradient
                                          invertGradient
                                          progress={
                                            (attributes.filter((a) =>
                                              a.jobOperationStepRecord.some(
                                                (r) => r.index === activeStep
                                              )
                                            ).length /
                                              attributes.length) *
                                            100
                                          }
                                        />
                                        <span className="text-xs text-muted-foreground">
                                          <Trans>
                                            {
                                              attributes.filter((a) =>
                                                a.jobOperationStepRecord.some(
                                                  (r) => r.index === activeStep
                                                )
                                              ).length
                                            }{" "}
                                            of {attributes.length} completed
                                          </Trans>
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })()}
                              {attributes.length > 0 && (
                                <>
                                  <div className="flex flex-col items-start justify-between w-full">
                                    <div className="flex flex-col w-full">
                                      <div>
                                        {attributes
                                          .sort(
                                            (a, b) =>
                                              (a.sortOrder ?? 0) -
                                              (b.sortOrder ?? 0)
                                          )
                                          .map((step, index) => (
                                            <StepsListItem
                                              key={`step-${step.id}`}
                                              activeStep={activeStep}
                                              step={step}
                                              compact={true}
                                              onRecord={onRecordStepRecord}
                                              onDelete={onDeleteStepRecord}
                                              operationId={operationId}
                                              className={
                                                index === attributes.length - 1
                                                  ? "border-none"
                                                  : ""
                                              }
                                            />
                                          ))}
                                      </div>
                                    </div>
                                  </div>
                                </>
                              )}
                            </VStack>
                          </TabsContent>
                          <TabsContent
                            value="parameters"
                            className="w-full flex-1 flex flex-col overflow-y-auto data-[state=inactive]:hidden"
                          >
                            <VStack
                              className="w-full flex-1 overflow-y-auto scroll-fade scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent"
                              spacing={0}
                            >
                              {parameters.length > 0 && (
                                <>
                                  <Separator />
                                  <div className="flex flex-col items-start justify-between w-full">
                                    <div className="flex flex-col gap-4 w-full">
                                      <div>
                                        {parameters
                                          .sort((a, b) =>
                                            (a.key ?? "").localeCompare(
                                              b.key ?? ""
                                            )
                                          )
                                          .map((p, index) => (
                                            <ParametersListItem
                                              key={`parameter-${p.id}`}
                                              parameter={p}
                                              operationId={operationId}
                                              className={
                                                index === parameters.length - 1
                                                  ? "border-none"
                                                  : ""
                                              }
                                            />
                                          ))}
                                      </div>
                                    </div>
                                  </div>
                                </>
                              )}
                            </VStack>
                          </TabsContent>
                        </Tabs>
                      </ScrollArea>
                    );
                  }}
                </Await>
              </Suspense>

              <ScrollArea className="flex-1 p-4 overflow-y-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-accent">
                <div
                  className="prose dark:prose-invert"
                  dangerouslySetInnerHTML={{
                    __html: generateHTML(
                      (operation.workInstruction ?? {}) as JSONContent
                    )
                  }}
                />
              </ScrollArea>
            </div>
          )}
        </TabsContent>
        <TabsContent
          value="chat"
          className="[grid-area:main] mt-0 h-full min-h-0"
        >
          <OperationChat operation={operation} />
        </TabsContent>
        {showControls && (
          <Controls
            className="[grid-area:dock]"
            collapsed={dockCollapsed}
            onCollapsedChange={onDockCollapsedChange}
          >
            <div className="flex w-full min-w-0 items-center gap-2 lg:flex-col lg:py-2">
              <dl className="hidden w-full gap-3 rounded-lg border bg-card p-3 lg:grid lg:group-data-[collapsed=true]/dock:hidden">
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">
                    <Trans>Work Center</Trans>
                  </dt>
                  <dd>
                    <Suspense
                      fallback={<span className="text-sm">...</span>}
                      key={`work-center-${operationId}`}
                    >
                      <Await resolve={workCenter}>
                        {(resolvedWorkCenter) =>
                          resolvedWorkCenter.data && (
                            <span className="line-clamp-1 text-sm font-medium">
                              {resolvedWorkCenter.data?.name}
                            </span>
                          )
                        }
                      </Await>
                    </Suspense>
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">
                    <Trans>Item</Trans>
                  </dt>
                  <dd className="line-clamp-1 text-sm font-medium">
                    {scope === "batch" && batchFacts
                      ? batchFacts.items.length === 1
                        ? batchFacts.items[0]
                        : t`${batchFacts.items.length} items`
                      : operation.itemReadableId}
                  </dd>
                </div>
              </dl>

              <WorkTypeToggle
                active={active}
                operation={displayOperation}
                value={eventType}
                onChange={setEventType}
                className="min-w-0 flex-1 lg:flex-none"
              />

              <StartStopButton
                eventType={eventType as (typeof productionEventType)[number]}
                job={job}
                operation={operation}
                setupProductionEvent={setupProductionEvent}
                laborProductionEvent={laborProductionEvent}
                machineProductionEvent={machineProductionEvent}
                isTrackedActivity={
                  !isBatched &&
                  (method?.requiresSerialTracking === true ||
                    method?.requiresBatchTracking === true)
                }
                trackedEntityId={trackedEntityId}
                batchId={batch?.id}
              />
              {/* What the big button will do, or what is running — the dock
                  only; the rail and the phone bar stay icon-sized. */}
              <div className="hidden flex-col items-center gap-0.5 text-center lg:flex lg:group-data-[collapsed=true]/dock:hidden">
                {runningType ? (
                  <>
                    <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      <span className="size-2 animate-pulse rounded-full bg-emerald-500" />
                      {workTypeLabels[runningType]}
                    </span>
                    <span className="font-mono text-lg tabular-nums">
                      {formatDurationMilliseconds(progress[runningType], {
                        style: "short"
                      })}
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {t`Start ${workTypeLabels[
                      eventType.toLowerCase() as keyof typeof workTypeLabels
                    ].toLowerCase()}`}
                  </span>
                )}
              </div>
              <div className="flex flex-row lg:hidden lg:group-data-[collapsed=true]/dock:flex lg:flex-col items-center gap-2 justify-center">
                <IconButtonWithTooltip
                  disabled={
                    !isBatched &&
                    parentIsSerial &&
                    trackedEntities.some(
                      (entity) =>
                        entity.id === trackedEntityId &&
                        `Operation ${operationId}` in
                          (entity.attributes as TrackedEntityAttributes)
                    )
                  }
                  icon={
                    isBatched ? (
                      <LuPackageCheck className="text-accent-foreground group-hover:text-accent-foreground/80" />
                    ) : (
                      <FaPlus className="text-accent-foreground group-hover:text-accent-foreground/80" />
                    )
                  }
                  tooltip={isBatched ? t`Complete Batch` : t`Log Completed`}
                  onClick={
                    isBatched ? batchCompleteModal.onOpen : completeModal.onOpen
                  }
                />
                <IconButtonWithTooltip
                  icon={
                    <LuEllipsisVertical className="text-accent-foreground group-hover:text-accent-foreground/80" />
                  }
                  tooltip={t`More Actions`}
                  onClick={actionsSheet.onOpen}
                />
              </div>
              <div className="hidden w-full flex-col gap-2 lg:flex lg:group-data-[collapsed=true]/dock:hidden">
                <Button
                  size="lg"
                  variant="secondary"
                  className="w-full"
                  leftIcon={isBatched ? <LuPackageCheck /> : <FaPlus />}
                  isDisabled={
                    !isBatched &&
                    parentIsSerial &&
                    trackedEntities.some(
                      (entity) =>
                        entity.id === trackedEntityId &&
                        `Operation ${operationId}` in
                          (entity.attributes as TrackedEntityAttributes)
                    )
                  }
                  onClick={
                    isBatched ? batchCompleteModal.onOpen : completeModal.onOpen
                  }
                >
                  {isBatched ? (
                    <Trans>Complete batch</Trans>
                  ) : (
                    <Trans>Log completed</Trans>
                  )}
                </Button>
                <Button
                  size="lg"
                  variant="ghost"
                  className="w-full"
                  leftIcon={<LuEllipsisVertical />}
                  onClick={actionsSheet.onOpen}
                >
                  <Trans>More actions</Trans>
                </Button>
              </div>
            </div>
          </Controls>
        )}
        {!["chat"].includes(activeTab) && (
          <Times className="[grid-area:status]">
            {/* Labelled meters: two per row on a phone, then as many columns
                as fit (four across a desktop). */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:gap-x-6 sm:grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
              {(
                [
                  {
                    type: "setup",
                    label: t`Setup`,
                    elapsed: progress.setup,
                    planned: displayOperation.setupDuration
                  },
                  {
                    type: "labor",
                    label: t`Labor`,
                    elapsed: progress.labor,
                    planned: displayOperation.laborDuration
                  },
                  {
                    type: "machine",
                    label: t`Machine`,
                    elapsed: progress.machine,
                    planned: displayOperation.machineDuration
                  }
                ] as const
              )
                .filter((meter) => meter.planned > 0)
                .map((meter) => {
                  // A batch with no planned time anywhere carries a 1ms
                  // placeholder plan (so ratios never divide by zero). That is
                  // not a plan: show elapsed time alone over an empty track.
                  const hasPlan = meter.planned > 1;
                  const elapsed = formatDurationMilliseconds(meter.elapsed, {
                    style: "short"
                  });
                  return (
                    <BarProgress
                      key={meter.type}
                      label={meter.label}
                      value={
                        hasPlan
                          ? `${elapsed} / ${formatDurationMilliseconds(
                              meter.planned,
                              { style: "short" }
                            )}`
                          : elapsed
                      }
                      gradient
                      invertGradient
                      progress={
                        hasPlan ? (meter.elapsed / meter.planned) * 100 : 0
                      }
                      activeClassName={
                        meter.elapsed > meter.planned
                          ? "bg-red-500"
                          : "bg-emerald-500"
                      }
                    />
                  );
                })}
              <BarProgress
                label={isBatched ? t`Batch quantity` : t`Quantity`}
                value={`${quantityProgress.complete} / ${quantityProgress.target}`}
                segments={[
                  {
                    value: quantityProgress.complete,
                    className: "bg-emerald-500"
                  },
                  {
                    value: quantityProgress.reworked,
                    className: "bg-yellow-500"
                  },
                  {
                    value: quantityProgress.scrapped,
                    className: "bg-red-500"
                  }
                ]}
                max={quantityProgress.target || 1}
                progress={
                  (quantityProgress.complete / (quantityProgress.target || 1)) *
                  100
                }
              />
            </div>
          </Times>
        )}
      </Tabs>
      <BottomSheet
        open={actionsSheet.isOpen}
        onOpenChange={(open) => {
          if (!open) actionsSheet.onClose();
        }}
      >
        <BottomSheetContent className="max-w-md mx-auto">
          <BottomSheetBody>
            <div className="flex flex-col gap-2 pb-2">
              {isBatched && (
                <button
                  type="button"
                  className="flex items-center gap-3 rounded-lg bg-accent px-4 py-4 text-accent-foreground ring-1 ring-black/5 active:scale-[0.98] transition-transform"
                  onClick={() => {
                    actionsSheet.onClose();
                    batchCompleteModal.onOpen();
                  }}
                >
                  <LuLayers className="size-4 shrink-0 stroke-muted-foreground" />
                  <span className="text-base/6 font-medium">
                    <Trans>Complete Batch</Trans>
                  </span>
                </button>
              )}
              {/* Scrap / Rework / Finish are per-operation writes. In batch mode
                  the batch completion records production + scrap per member, so
                  these are hidden to avoid double-counting a member. */}
              {!isBatched && (
                <>
                  <button
                    type="button"
                    className="flex items-center gap-3 rounded-lg bg-accent px-4 py-4 text-accent-foreground ring-1 ring-black/5 active:scale-[0.98] transition-transform"
                    onClick={() => {
                      actionsSheet.onClose();
                      scrapModal.onOpen();
                    }}
                  >
                    <FaTrash className="size-4 shrink-0 fill-muted-foreground" />
                    <span className="text-base/6 font-medium">
                      <Trans>Scrap</Trans>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-3 rounded-lg bg-accent px-4 py-4 text-accent-foreground ring-1 ring-black/5 active:scale-[0.98] transition-transform"
                    onClick={() => {
                      actionsSheet.onClose();
                      reworkModal.onOpen();
                    }}
                  >
                    <LuGitPullRequest className="size-4 shrink-0 stroke-muted-foreground" />
                    <span className="text-base/6 font-medium">
                      <Trans>Rework</Trans>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-3 rounded-lg bg-accent px-4 py-4 text-accent-foreground ring-1 ring-black/5 active:scale-[0.98] transition-transform"
                    onClick={() => {
                      actionsSheet.onClose();
                      finishModal.onOpen();
                    }}
                  >
                    <LuCheck className="size-4 shrink-0 stroke-muted-foreground" />
                    <span className="text-base/6 font-medium">
                      <Trans>Finish</Trans>
                    </span>
                  </button>
                </>
              )}
              <Suspense>
                <Await resolve={workCenter}>
                  {(resolvedWorkCenter) =>
                    resolvedWorkCenter.data &&
                    !resolvedWorkCenter.data.isBlocked ? (
                      <button
                        type="button"
                        className="flex items-center gap-3 rounded-lg bg-accent px-4 py-4 text-accent-foreground ring-1 ring-black/5 active:scale-[0.98] transition-transform"
                        onClick={() => {
                          actionsSheet.onClose();
                          maintenanceModal.onOpen();
                        }}
                      >
                        <LuWrench className="size-4 shrink-0 stroke-muted-foreground" />
                        <span className="text-base/6 font-medium">
                          <Trans>Maintenance</Trans>
                        </span>
                      </button>
                    ) : null
                  }
                </Await>
              </Suspense>
              <button
                type="button"
                className="flex items-center gap-3 rounded-lg bg-accent px-4 py-4 text-accent-foreground ring-1 ring-black/5 active:scale-[0.98] transition-transform"
                onClick={() => {
                  actionsSheet.onClose();
                  qualityIssueModal.onOpen();
                }}
              >
                <LuTriangleAlert className="size-4 shrink-0 stroke-muted-foreground" />
                <span className="text-base/6 font-medium">
                  <Trans>Quality Issue</Trans>
                </span>
              </button>
            </div>
          </BottomSheetBody>
        </BottomSheetContent>
      </BottomSheet>
      {reworkModal.isOpen && (
        <ReworkModal
          operation={operation}
          jobId={job.id!}
          isOpen={reworkModal.isOpen}
          onClose={reworkModal.onClose}
          trackedEntities={trackedEntities}
          parentIsSerial={parentIsSerial}
          parentIsBatch={parentIsBatch}
        />
      )}
      {scrapModal.isOpen && (
        <QuantityModal
          type="scrap"
          laborProductionEvent={laborProductionEvent}
          machineProductionEvent={machineProductionEvent}
          operation={operation}
          parentIsSerial={parentIsSerial}
          parentIsBatch={parentIsBatch}
          setupProductionEvent={setupProductionEvent}
          trackedEntityId={trackedEntityId}
          trackedEntityReadableId={
            trackedEntities.find((entity) => entity.id === trackedEntityId)
              ?.readableId ?? undefined
          }
          onClose={scrapModal.onClose}
        />
      )}
      {completeModal.isOpen && (
        <Suspense key={`complete-modal-${operationId}`}>
          <Await resolve={materials}>
            {(resolvedMaterials) => {
              return (
                <QuantityModal
                  type="complete"
                  laborProductionEvent={laborProductionEvent}
                  machineProductionEvent={machineProductionEvent}
                  materials={resolvedMaterials.materials}
                  operation={operation}
                  parentIsSerial={parentIsSerial}
                  parentIsBatch={parentIsBatch}
                  setupProductionEvent={setupProductionEvent}
                  trackedEntityId={trackedEntityId}
                  onClose={completeModal.onClose}
                />
              );
            }}
          </Await>
        </Suspense>
      )}
      {/* @ts-ignore */}
      {finishModal.isOpen && (
        <Suspense key={`finish-modal-${operationId}`}>
          <Await resolve={procedure}>
            {(resolvedProcedure) => {
              const { attributes } = resolvedProcedure;
              const allStepsRecorded = attributes.every(
                (a) => a.jobOperationStepRecord !== null
              );
              return (
                <QuantityModal
                  type="finish"
                  allStepsRecorded={allStepsRecorded}
                  laborProductionEvent={laborProductionEvent}
                  machineProductionEvent={machineProductionEvent}
                  operation={operation}
                  setupProductionEvent={setupProductionEvent}
                  trackedEntityId={trackedEntityId}
                  onClose={finishModal.onClose}
                />
              );
            }}
          </Await>
        </Suspense>
      )}

      {batch && batchCompleteModal.isOpen && (
        <BatchCompleteModal
          batch={batch}
          isCompleting={isCompleting}
          fetcher={batchCompleteFetcher}
          onClose={batchCompleteModal.onClose}
        />
      )}

      {serialModal.isOpen && (
        <SerialSelectorModal
          availableEntities={availableEntities}
          onClose={serialModal.onClose}
          onCancel={() => navigate(path.to.operations)}
          onSelect={(entity) => {
            const entityIndex = availableEntities.findIndex(
              (e) => e.id === entity.id
            );
            if (entityIndex !== -1) {
              setActiveStep(entityIndex);
            }
            setParams({
              trackedEntityId: entity.id
            });
            serialModal.onClose();
          }}
        />
      )}

      {attributeRecordModal.isOpen && selectedStep ? (
        <RecordModal
          key={selectedStep.id}
          activeStep={activeStep}
          attribute={selectedStep}
          onClose={onDeselectStep}
        />
      ) : null}

      {attributeRecordDeleteModal.isOpen && selectedStep && (
        <DeleteStepRecordModal
          onClose={onDeselectStep}
          id={
            selectedStep?.jobOperationStepRecord.find(
              (r) => r.index === activeStep
            )?.id ?? ""
          }
          title={t`Delete Step`}
          description={t`Are you sure you want to delete this step?`}
        />
      )}

      <QualityIssueModal
        operationId={operation.id}
        trackedEntityId={
          parentIsSerial || parentIsBatch ? trackedEntityId : undefined
        }
        isOpen={qualityIssueModal.isOpen}
        onClose={qualityIssueModal.onClose}
      />

      <Suspense key={`maintenance-modal-${operationId}`}>
        <Await resolve={workCenter}>
          {(resolvedWorkCenter) =>
            resolvedWorkCenter.data && (
              <MaintenanceDispatch
                workCenter={resolvedWorkCenter.data}
                isOpen={maintenanceModal.isOpen}
                onClose={maintenanceModal.onClose}
              />
            )
          }
        </Await>
      </Suspense>
    </>
  );
};

function recordSetIsStarted(
  attributes: JobOperationStep[],
  activeStep: number
) {
  return attributes.some((att) =>
    att.jobOperationStepRecord.some(
      (record) =>
        record.index === activeStep &&
        (record.value !== null ||
          record.numericValue !== null ||
          record.booleanValue !== null ||
          record.userValue !== null)
    )
  );
}
