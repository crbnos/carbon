import { useCarbon } from "@carbon/auth";
import { Hidden, NumberControlled, ValidatedForm } from "@carbon/form";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Copy,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Heading,
  HStack,
  IconButton,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Spinner,
  SplitButton,
  Status,
  useDisclosure,
  useMount,
  VStack
} from "@carbon/react";
import { formatDate } from "@carbon/utils";
import {
  getLocalTimeZone,
  isSameDay,
  parseDate,
  today
} from "@internationalized/date";
import { Trans, useLingui } from "@lingui/react/macro";
import { useMemo, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuBlocks,
  LuCheckCheck,
  LuChevronDown,
  LuCircleCheck,
  LuCirclePause,
  LuCirclePlay,
  LuCircleStop,
  LuClipboardList,
  LuClock,
  LuEllipsisVertical,
  LuList,
  LuLoaderCircle,
  LuPanelLeft,
  LuPanelRight,
  LuQrCode,
  LuSettings,
  LuShoppingCart,
  LuSquareSigma,
  LuTable,
  LuTrash,
  LuTriangleAlert,
  LuWorkflow,
  LuZap
} from "react-icons/lu";
import { RiProgress8Line } from "react-icons/ri";
import type { FetcherWithComponents } from "react-router";
import { Link, useFetcher, useNavigate, useParams } from "react-router";
import { useAuditLog } from "~/components/AuditLog";
import { Location, StorageUnit } from "~/components/Form";
import { usePanels } from "~/components/Layout";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import Select from "~/components/Select";
import SupplierAvatar from "~/components/SupplierAvatar";
import { flattenTree } from "~/components/TreeView";
import {
  useOptimisticLocation,
  usePermissions,
  useRouteData,
  useUser
} from "~/hooks";
import { useSuppliers } from "~/stores";
import { generateBomIds } from "~/utils/bom";
import { path } from "~/utils/path";
import { isJobLocked, jobCompleteValidator } from "../../production.models";
import { getJobMethodTree } from "../../production.service";
import type { Job } from "../../types";
import JobStatus from "./JobStatus";
import {
  getDefaultSerialCompleteQuantity,
  getFinishedUnreceivedQuantity,
  getReceivableSerialUnits,
  type JobReceiptSnapshot
} from "./job-complete-logic";
import { makeMethodsMissingOperations } from "./job-release-logic";

const JobHeader = () => {
  const navigate = useNavigate();
  const { t } = useLingui();
  const getExplorerLabel = (type: string) => {
    switch (type) {
      case "materials":
        return t`Materials`;
      case "operations":
        return t`Operations`;
      case "dag":
        return "Workflow";
      case "step-records":
        return t`Step Records`;
      case "events":
        return t`Production Events`;
      case "quantities":
        return t`Production Quantities`;
      default:
        return t`Job`;
    }
  };
  const permissions = usePermissions();
  const { jobId } = useParams();
  if (!jobId) throw new Error("jobId not found");

  const { company } = useUser();
  const location = useOptimisticLocation();
  const { toggleExplorer, toggleProperties } = usePanels();
  const { trigger: auditLogTrigger, drawer: auditLogDrawer } = useAuditLog({
    entityType: "productionJob",
    entityId: jobId,
    companyId: company.id,
    variant: "dropdown"
  });

  const releaseModal = useDisclosure();
  const cancelModal = useDisclosure();
  const completeModal = useDisclosure();
  const deleteJobModal = useDisclosure();
  const expediteModal = useDisclosure();
  const routeData = useRouteData<{
    job: Job;
    unbatchedBatchableOperations?: number;
  }>(path.to.job(jobId));

  const statusFetcher = useFetcher<{}>();
  const expediteFetcher = useFetcher<{
    expedite: {
      projectedCompletionAt: string | null;
      cause: string | null;
    } | null;
  }>();
  const status = routeData?.job?.status;
  const unbatchedBatchableOperations =
    routeData?.unbatchedBatchableOperations ?? 0;

  const getOptionFromPath = (jobId: string) => {
    if (location.pathname.includes(path.to.jobMaterials(jobId)))
      return "materials";
    if (location.pathname.includes(path.to.jobOperations(jobId)))
      return "operations";
    if (location.pathname.includes(path.to.jobOperationStepRecords(jobId)))
      return "step-records";
    if (location.pathname.includes(path.to.jobProductionEvents(jobId)))
      return "events";
    if (location.pathname.includes(path.to.jobProductionQuantities(jobId)))
      return "quantities";
    if (location.pathname.includes(path.to.jobDag(jobId))) return "dag";
    return "details";
  };

  const currentValue = getOptionFromPath(jobId);

  const markAsPlanned = () => {
    statusFetcher.submit(
      {
        status: "Planned"
      },
      { method: "post", action: path.to.jobStatus(jobId) }
    );
  };

  const todaysDate = useMemo(() => today(getLocalTimeZone()), []);

  // Forecast slack: calendar days between the projected completion (forward-ASAP
  // finish) and the promised due date. Positive = late, negative = early.
  const projectedCompletionAt = routeData?.job?.projectedCompletionAt;
  const jobDueDate = routeData?.job?.dueDate;
  const slack = useMemo(() => {
    if (!projectedCompletionAt || !jobDueDate) return null;
    const days = parseDate(projectedCompletionAt.slice(0, 10)).compare(
      parseDate(jobDueDate)
    );
    if (days === 0) return null;
    return {
      late: days > 0,
      absDays: Math.abs(days),
      projectedDate: formatDate(projectedCompletionAt.slice(0, 10))
    };
  }, [projectedCompletionAt, jobDueDate]);

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between gap-x-4 p-2 bg-card border-b h-[var(--header-height)] overflow-x-auto scrollbar-hide ">
        <HStack>
          <IconButton
            aria-label={t`Toggle Explorer`}
            icon={<LuPanelLeft />}
            onClick={toggleExplorer}
            variant="ghost"
          />
          <Link to={path.to.jobDetails(jobId)}>
            <Heading size="h4" className="flex items-center gap-2">
              <span>{routeData?.job?.jobId}</span>
            </Heading>
          </Link>
          <Copy text={routeData?.job?.jobId ?? ""} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                aria-label={t`More options`}
                icon={<LuEllipsisVertical />}
                variant="secondary"
                size="sm"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {auditLogTrigger}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={
                  !["Ready", "In Progress", "Paused"].includes(status ?? "") ||
                  expediteFetcher.state !== "idle" ||
                  !permissions.can("view", "production")
                }
                onClick={() => {
                  expediteModal.onOpen();
                  expediteFetcher.submit(
                    {},
                    { method: "post", action: path.to.jobExpedite(jobId) }
                  );
                }}
              >
                <DropdownMenuIcon icon={<LuZap />} />
                {t`Best case…`}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={
                  !["Cancelled", "Completed"].includes(
                    routeData?.job?.status ?? ""
                  ) ||
                  statusFetcher.state !== "idle" ||
                  !permissions.can("update", "production")
                }
                onClick={() => {
                  statusFetcher.submit(
                    {
                      status:
                        routeData?.job?.status === "Cancelled"
                          ? "Draft"
                          : "In Progress"
                    },
                    {
                      method: "post",
                      action: path.to.jobStatus(jobId)
                    }
                  );
                }}
              >
                <DropdownMenuIcon icon={<LuLoaderCircle />} />
                Reopen
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={
                  !permissions.can("delete", "production") ||
                  !permissions.is("employee") ||
                  isJobLocked(routeData?.job?.status)
                }
                destructive
                onClick={deleteJobModal.onOpen}
              >
                <DropdownMenuIcon icon={<LuTrash />} />
                Delete Job
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <JobStatus status={routeData?.job?.status} />
          {["Draft", "Planned", "In Progress", "Ready", "Paused"].includes(
            routeData?.job?.status ?? ""
          ) && (
            <>
              {routeData?.job?.dueDate &&
                isSameDay(parseDate(routeData?.job?.dueDate), todaysDate) && (
                  <JobStatus status="Due Today" />
                )}
              {routeData?.job?.dueDate &&
                parseDate(routeData?.job?.dueDate) < todaysDate && (
                  <JobStatus status="Overdue" />
                )}
              {slack && (
                <Status
                  color={slack.late ? "red" : "green"}
                  tooltip={`${t`Projected completion`}: ${slack.projectedDate}`}
                >
                  {slack.late
                    ? t`${slack.absDays}d late`
                    : t`${slack.absDays}d early`}
                </Status>
              )}
            </>
          )}
          {unbatchedBatchableOperations > 0 && (
            <Status
              color="gray"
              tooltip={
                unbatchedBatchableOperations === 1
                  ? t`1 batchable operation is not in a batch — it runs individually until batched`
                  : t`${unbatchedBatchableOperations} batchable operations are not in a batch — they run individually until batched`
              }
            >
              {t`${unbatchedBatchableOperations} awaiting batching`}
            </Status>
          )}
        </HStack>
        <HStack>
          {routeData?.job?.salesOrderId && routeData?.job.salesOrderLineId && (
            <Button leftIcon={<RiProgress8Line />} variant="secondary" asChild>
              <Link
                to={path.to.salesOrderLine(
                  routeData?.job?.salesOrderId,
                  routeData?.job?.salesOrderLineId
                )}
              >
                Sales Order
              </Link>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                leftIcon={currentValue === "details" ? <LuList /> : <LuTable />}
                rightIcon={<LuChevronDown />}
                variant="secondary"
              >
                {getExplorerLabel(currentValue)}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              <DropdownMenuItem asChild>
                <a
                  target="_blank"
                  href={path.to.file.jobTravelerByJobId(jobId)}
                  rel="noreferrer"
                >
                  <DropdownMenuIcon icon={<LuQrCode />} />
                  Job Traveler
                </a>
              </DropdownMenuItem>
              <DropdownMenuRadioGroup
                value={currentValue}
                onValueChange={(option) => {
                  navigate(getExplorePath(jobId, option));
                }}
              >
                <DropdownMenuRadioItem value="details">
                  <DropdownMenuIcon icon={getExplorerMenuIcon("details")} />
                  {getExplorerLabel("details")}
                </DropdownMenuRadioItem>
                <DropdownMenuSeparator />
                {[
                  "materials",
                  "operations",
                  ...(status !== "Draft" && status !== "Planned" ? ["dag"] : [])
                ].map((i) => (
                  <DropdownMenuRadioItem value={i} key={i}>
                    <DropdownMenuIcon icon={getExplorerMenuIcon(i)} />
                    {getExplorerLabel(i)}
                  </DropdownMenuRadioItem>
                ))}
                <DropdownMenuSeparator />
                {["events", "quantities", "step-records"].map((i) => (
                  <DropdownMenuRadioItem value={i} key={i}>
                    <DropdownMenuIcon icon={getExplorerMenuIcon(i)} />
                    {getExplorerLabel(i)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {status !== "Paused" ? (
            <statusFetcher.Form method="post" action={path.to.jobStatus(jobId)}>
              <input type="hidden" name="status" value="Paused" />
              <Button
                isLoading={
                  statusFetcher.state !== "idle" &&
                  statusFetcher.formData?.get("status") === "Paused"
                }
                isDisabled={
                  !["Ready", "In Progress"].includes(status ?? "") ||
                  statusFetcher.state !== "idle" ||
                  !permissions.can("update", "production")
                }
                leftIcon={<LuCirclePause />}
                type="submit"
                variant="secondary"
              >
                Pause
              </Button>
            </statusFetcher.Form>
          ) : (
            <statusFetcher.Form method="post" action={path.to.jobStatus(jobId)}>
              <input type="hidden" name="status" value="Ready" />
              <Button
                isLoading={
                  statusFetcher.state !== "idle" &&
                  statusFetcher.formData?.get("status") === "Ready"
                }
                isDisabled={
                  statusFetcher.state !== "idle" ||
                  !permissions.can("update", "production")
                }
                leftIcon={<LuCirclePlay />}
                type="submit"
              >
                Resume
              </Button>
            </statusFetcher.Form>
          )}

          <SplitButton
            onClick={releaseModal.onOpen}
            isLoading={
              statusFetcher.state !== "idle" &&
              statusFetcher.formData?.get("status") === "Ready"
            }
            isDisabled={
              !["Draft", "Planned"].includes(status ?? "") ||
              statusFetcher.state !== "idle" ||
              !permissions.can("update", "production") ||
              (routeData?.job?.quantity === 0 &&
                routeData?.job?.scrapQuantity === 0)
            }
            leftIcon={<LuCirclePlay />}
            variant={
              ["Draft", "Planned"].includes(status ?? "")
                ? "primary"
                : "secondary"
            }
            dropdownItems={[
              {
                label: <JobStatus status="Planned" />,
                icon: <LuCheckCheck />,
                onClick: markAsPlanned
              }
            ]}
          >
            Release
          </SplitButton>

          <Button
            onClick={completeModal.onOpen}
            isLoading={
              statusFetcher.state !== "idle" &&
              statusFetcher.formAction === path.to.jobComplete(jobId)
            }
            isDisabled={
              ["Completed", "Cancelled"].includes(status ?? "") ||
              statusFetcher.state !== "idle" ||
              !permissions.can("update", "production")
            }
            leftIcon={<LuCircleCheck />}
            variant={status === "Completed" ? "primary" : "secondary"}
          >
            Complete
          </Button>
          <Button
            onClick={cancelModal.onOpen}
            isLoading={
              statusFetcher.state !== "idle" &&
              statusFetcher.formData?.get("status") === "Cancelled"
            }
            isDisabled={
              ["Cancelled", "Completed"].includes(status ?? "") ||
              statusFetcher.state !== "idle" ||
              !permissions.can("update", "production")
            }
            leftIcon={<LuCircleStop />}
            variant="secondary"
          >
            Cancel
          </Button>
          <IconButton
            aria-label={t`Toggle Properties`}
            icon={<LuPanelRight />}
            onClick={toggleProperties}
            variant="ghost"
          />
        </HStack>
      </div>
      {releaseModal.isOpen && (
        <JobStartModal
          job={routeData?.job}
          onClose={releaseModal.onClose}
          fetcher={statusFetcher}
        />
      )}
      {cancelModal.isOpen && (
        <JobCancelModal
          job={routeData?.job}
          onClose={cancelModal.onClose}
          fetcher={statusFetcher}
        />
      )}
      {completeModal.isOpen && (
        <JobCompleteModal
          job={routeData?.job}
          onClose={completeModal.onClose}
          fetcher={statusFetcher}
        />
      )}
      {expediteModal.isOpen && (
        <JobExpediteModal
          job={routeData?.job}
          onClose={expediteModal.onClose}
          fetcher={expediteFetcher}
        />
      )}
      {deleteJobModal.isOpen && (
        <ConfirmDelete
          action={path.to.deleteJob(jobId)}
          isOpen={deleteJobModal.isOpen}
          name={routeData?.job?.jobId!}
          text={`Are you sure you want to delete ${routeData?.job
            ?.jobId!}? This cannot be undone.`}
          onCancel={() => {
            deleteJobModal.onClose();
          }}
          onSubmit={() => {
            deleteJobModal.onClose();
          }}
        />
      )}
      {auditLogDrawer}
    </>
  );
};

export default JobHeader;

function getExplorerMenuIcon(type: string) {
  switch (type) {
    case "materials":
      return <LuBlocks />;
    case "operations":
      return <LuSettings />;
    case "dag":
      return <LuWorkflow />;
    case "step-records":
      return <LuClipboardList />;
    case "events":
      return <LuClock />;
    case "quantities":
      return <LuSquareSigma />;
    default:
      return <LuCirclePlay />;
  }
}

const getExplorePath = (jobId: string, type: string) => {
  switch (type) {
    case "materials":
      return path.to.jobMaterials(jobId);
    case "operations":
      return path.to.jobOperations(jobId);
    case "dag":
      return path.to.jobDag(jobId);
    case "step-records":
      return path.to.jobOperationStepRecords(jobId);
    case "events":
      return path.to.jobProductionEvents(jobId);
    case "quantities":
      return path.to.jobProductionQuantities(jobId);
    default:
      return path.to.jobDetails(jobId);
  }
};

export function JobStartModal({
  job,
  onClose,
  fetcher
}: {
  job?: Job;
  fetcher: FetcherWithComponents<{}>;
  onClose: () => void;
}) {
  const { carbon } = useCarbon();
  const [suppliers] = useSuppliers();
  const [loading, setLoading] = useState(true);
  const [missingOperationAssemblies, setMissingOperationAssemblies] = useState<
    { bomId: string; description: string }[]
  >([]);
  const [
    eachOutsideOperationHasASupplier,
    setEachOutsideOperationHasASupplier
  ] = useState(false);
  const [hasOutsideOperations, setHasOutsideOperations] = useState(false);
  const [
    existingPurchaseOrdersBySupplierId,
    setExistingPurchaseOrdersBySupplierId
  ] = useState<Record<string, { id: string; purchaseOrderId: string }[]>>({});
  const [
    selectedPurchaseOrdersBySupplierId,
    setSelectedPurchaseOrdersBySupplierId
  ] = useState<Record<string, string>>({});
  // Outside operations whose process offers MORE THAN ONE supplier — the user
  // picks which one (defaulting to the first). Single-supplier and explicitly
  // assigned operations never appear here; they resolve automatically.
  const [outsideOperationChoices, setOutsideOperationChoices] = useState<
    {
      id: string;
      description: string;
      options: { supplierProcessId: string; supplierId: string }[];
    }[]
  >([]);
  const [
    selectedSupplierProcessByOperationId,
    setSelectedSupplierProcessByOperationId
  ] = useState<Record<string, string>>({});

  const validate = async (choicesOverride?: Record<string, string>) => {
    if (!carbon || !job) return;
    const [makeMethod, materials, operations, methodTree] = await Promise.all([
      carbon
        .from("jobMakeMethod")
        .select("*")
        .eq("jobId", job.id!)
        .is("parentMaterialId", null)
        .single(),
      carbon
        .from("jobMaterialWithMakeMethodId")
        .select("*")
        .eq("jobId", job.id!),
      carbon.from("jobOperation").select("*").eq("jobId", job.id!),
      getJobMethodTree(carbon, job.id!)
    ]);

    // Check for existing purchase order lines for outside operations
    const outsideOperations =
      operations.data?.filter(
        (op) => op.operationType === "Outside Processing"
      ) || [];
    const existingPurchaseOrderLines =
      outsideOperations.length > 0
        ? await carbon
            .from("purchaseOrderLine")
            .select("jobOperationId")
            .in(
              "jobOperationId",
              outsideOperations.map((op) => op.id)
            )
        : { data: [] };

    const existingJobOperationIds = new Set(
      existingPurchaseOrderLines.data?.map((pol) => pol.jobOperationId) ?? []
    );

    // Outside operations that still need handling (no existing purchase order line)
    const outsideOperationsWithoutPurchaseOrders = outsideOperations.filter(
      (op) => !existingJobOperationIds.has(op.id)
    );

    // Resolve each operation's supplier: its own supplier process, or — when the
    // operation has none — the sole supplier configured for its process. A process
    // with exactly one supplier is unambiguous, so it counts as assigned; a process
    // with zero or multiple suppliers still requires an explicit per-operation pick.
    type SupplierProcessRef = {
      id: string;
      supplierId: string;
      processId: string;
    };

    const outsideProcessIds = Array.from(
      new Set(
        outsideOperationsWithoutPurchaseOrders
          .map((op) => op.processId)
          .filter(Boolean) as string[]
      )
    );
    const explicitSupplierProcessIds = Array.from(
      new Set(
        outsideOperationsWithoutPurchaseOrders
          .map((op) => op.operationSupplierProcessId)
          .filter(Boolean) as string[]
      )
    );

    const supplierProcessesByProcess =
      outsideProcessIds.length > 0
        ? await carbon
            .from("supplierProcess")
            .select("id, supplierId, processId")
            .in("processId", outsideProcessIds)
        : { data: [] as SupplierProcessRef[] };
    const supplierProcessesById =
      explicitSupplierProcessIds.length > 0
        ? await carbon
            .from("supplierProcess")
            .select("id, supplierId, processId")
            .in("id", explicitSupplierProcessIds)
        : { data: [] as SupplierProcessRef[] };

    const supplierProcessById = new Map<string, SupplierProcessRef>();
    for (const sp of [
      ...(supplierProcessesByProcess.data ?? []),
      ...(supplierProcessesById.data ?? [])
    ]) {
      supplierProcessById.set(sp.id, sp);
    }
    const supplierProcessesByProcessId = new Map<
      string,
      SupplierProcessRef[]
    >();
    for (const sp of supplierProcessesByProcess.data ?? []) {
      const list = supplierProcessesByProcessId.get(sp.processId) ?? [];
      list.push(sp);
      supplierProcessesByProcessId.set(sp.processId, list);
    }

    // Resolve each operation's supplier: its own supplier process, the process's
    // sole supplier, or — when the process offers several — a user pick (defaulting
    // to the first candidate). Only a process with NO supplier at all is a genuine
    // "missing supplier". `choicesOverride` carries the picks on a re-run.
    const supplierProcessChoice =
      choicesOverride ?? selectedSupplierProcessByOperationId;
    const resolvedSupplierChoice: Record<string, string> = {};
    const operationChoices: {
      id: string;
      description: string;
      options: { supplierProcessId: string; supplierId: string }[];
    }[] = [];

    const resolveSupplierProcess = (op: {
      id: string;
      description: string | null;
      operationSupplierProcessId: string | null;
      processId: string | null;
    }): SupplierProcessRef | null => {
      if (op.operationSupplierProcessId) {
        return supplierProcessById.get(op.operationSupplierProcessId) ?? null;
      }
      const candidates = op.processId
        ? (supplierProcessesByProcessId.get(op.processId) ?? [])
        : [];
      if (candidates.length === 0) return null;
      if (candidates.length === 1) return candidates[0];
      // Multiple suppliers for the process — the user chooses which one.
      operationChoices.push({
        id: op.id,
        description: op.description ?? op.id,
        options: candidates.map((c) => ({
          supplierProcessId: c.id,
          supplierId: c.supplierId
        }))
      });
      const chosenId =
        supplierProcessChoice[op.id] &&
        candidates.some((c) => c.id === supplierProcessChoice[op.id])
          ? supplierProcessChoice[op.id]
          : candidates[0].id;
      resolvedSupplierChoice[op.id] = chosenId;
      return supplierProcessById.get(chosenId) ?? null;
    };

    const operationsWithSupplier = outsideOperationsWithoutPurchaseOrders.map(
      (op) => ({ op, supplierProcess: resolveSupplierProcess(op) })
    );

    const uniqueSupplierIds = new Set(
      operationsWithSupplier
        .map((entry) => entry.supplierProcess?.supplierId)
        .filter(Boolean) as string[]
    );

    setOutsideOperationChoices(operationChoices);
    setSelectedSupplierProcessByOperationId(resolvedSupplierChoice);

    if (uniqueSupplierIds.size) {
      const draftPurchaseOrders = await carbon
        .from("purchaseOrder")
        .select("id, purchaseOrderId, supplierId")
        .eq("status", "Draft")
        .in("supplierId", Array.from(uniqueSupplierIds));

      setExistingPurchaseOrdersBySupplierId(
        draftPurchaseOrders.data?.reduce<
          Record<string, { id: string; purchaseOrderId: string }[]>
        >((acc, po) => {
          acc[po.supplierId] = acc[po.supplierId] || [];
          acc[po.supplierId].push({
            id: po.id,
            purchaseOrderId: po.purchaseOrderId
          });
          return acc;
        }, {}) ?? {}
      );
    }

    setSelectedPurchaseOrdersBySupplierId((prev) =>
      Array.from(uniqueSupplierIds).reduce<Record<string, string>>(
        (acc, supplierId) => {
          acc[supplierId] = prev[supplierId] ?? "new";
          return acc;
        },
        {}
      )
    );

    const flatMethod =
      methodTree.data && methodTree.data.length > 0
        ? flattenTree(methodTree.data[0])
        : [];
    const bomIds = generateBomIds(flatMethod);
    const bomInfoByMakeMethodId = new Map(
      flatMethod.map((node, index) => [
        node.data.jobMaterialMakeMethodId,
        {
          bomId: bomIds[index],
          description: node.data.description || node.data.itemReadableId
        }
      ])
    );

    const missingAssemblies = makeMethodsMissingOperations(
      makeMethod.data?.id ?? null,
      materials.data ?? [],
      operations.data ?? []
    ).map((makeMethodId) => {
      const info = bomInfoByMakeMethodId.get(makeMethodId ?? "");
      return info
        ? { bomId: info.bomId, description: info.description }
        : { bomId: "?", description: makeMethodId ?? "Unknown" };
    });

    flushSync(() => {
      setMissingOperationAssemblies(missingAssemblies);

      // Show the release UI whenever there are outside operations still needing handling,
      // whether or not they have a supplier yet
      setHasOutsideOperations(
        outsideOperationsWithoutPurchaseOrders.length > 0
      );

      // An outside operation "has a supplier" when it resolves to one — either its
      // own supplier process or its process's sole supplier.
      setEachOutsideOperationHasASupplier(
        operationsWithSupplier.length === 0 ||
          operationsWithSupplier.every(
            (entry) => entry.supplierProcess !== null
          )
      );
    });

    setLoading(false);
  };

  useMount(() => {
    validate();
  });

  if (!job) return null;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <ModalContent
        size={
          hasOutsideOperations && eachOutsideOperationHasASupplier
            ? "large"
            : "medium"
        }
      >
        <ModalHeader>
          <ModalTitle>
            <Trans>Release Job</Trans> {job?.jobId}
          </ModalTitle>
        </ModalHeader>
        {loading ? (
          <ModalBody>
            <div className="flex flex-col h-[118px] w-full items-center justify-center gap-2">
              <Spinner className="size-8" />
              <p className="text-sm">
                <Trans>Validating job...</Trans>
              </p>
            </div>
          </ModalBody>
        ) : (
          <>
            <ModalBody>
              <VStack>
                {missingOperationAssemblies.length === 0 &&
                  eachOutsideOperationHasASupplier && (
                    <p className="text-sm">
                      <Trans>
                        Are you sure you want to release this job? It will
                        become available to the shop floor, and drive purchasing
                        and production.
                      </Trans>
                    </p>
                  )}
                {hasOutsideOperations && eachOutsideOperationHasASupplier && (
                  <>
                    <Alert>
                      <LuShoppingCart />
                      <AlertTitle>
                        <Trans>Purchase orders required</Trans>
                      </AlertTitle>
                      <AlertDescription>
                        <Trans>
                          A new purchase order will be created for each
                          supplier. Alternatively, you can choose an existing
                          draft purchase order for the supplier to add the
                          outside operations to.
                        </Trans>
                      </AlertDescription>
                    </Alert>
                    {outsideOperationChoices.length > 0 && (
                      <div className="flex flex-col gap-2 w-full">
                        <p className="text-sm text-muted-foreground">
                          <Trans>
                            These operations use a process with multiple
                            suppliers. Choose a supplier for each.
                          </Trans>
                        </p>
                        {outsideOperationChoices.map((operation) => (
                          <div
                            key={operation.id}
                            className="flex justify-between items-center gap-4 text-sm rounded-lg border p-4 w-full"
                          >
                            <span className="font-medium">
                              {operation.description}
                            </span>
                            <Select
                              size="sm"
                              value={
                                selectedSupplierProcessByOperationId[
                                  operation.id
                                ] ?? ""
                              }
                              options={operation.options.map((option) => ({
                                value: option.supplierProcessId,
                                label:
                                  suppliers.find(
                                    (s) => s.id === option.supplierId
                                  )?.name ?? option.supplierId
                              }))}
                              onChange={(value) => {
                                const next = {
                                  ...selectedSupplierProcessByOperationId,
                                  [operation.id]: value as string
                                };
                                setSelectedSupplierProcessByOperationId(next);
                                validate(next);
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                    {Object.entries(selectedPurchaseOrdersBySupplierId).map(
                      ([supplierId, purchaseOrderId]) => {
                        const purchaseOrders =
                          existingPurchaseOrdersBySupplierId[supplierId] ?? [];
                        return (
                          <div
                            key={supplierId}
                            className="flex justify-between items-center text-sm rounded-lg border p-4 w-full"
                          >
                            <SupplierAvatar supplierId={supplierId} />

                            <Select
                              size="sm"
                              value={purchaseOrderId}
                              isReadOnly={
                                !Array.isArray(purchaseOrders) ||
                                purchaseOrders.length === 0
                              }
                              options={[
                                {
                                  value: "new",
                                  label: "Create New"
                                },
                                ...purchaseOrders.map((po) => ({
                                  label: po.purchaseOrderId,
                                  value: po.id
                                }))
                              ]}
                              onChange={(value) => {
                                setSelectedPurchaseOrdersBySupplierId(
                                  (prev) => ({
                                    ...prev,
                                    [supplierId]: value
                                  })
                                );
                              }}
                            />
                          </div>
                        );
                      }
                    )}
                  </>
                )}
                {missingOperationAssemblies.length > 0 && (
                  <Alert variant="warning">
                    <LuTriangleAlert />
                    <AlertTitle>
                      <Trans>Missing Operations</Trans>
                    </AlertTitle>
                    <AlertDescription>
                      <Trans>
                        The following assemblies have no operations. Please
                        assign an operation to each before releasing.
                      </Trans>
                      <ul className="mt-2 list-disc pl-4 space-y-1">
                        {[...missingOperationAssemblies]
                          .sort((a, b) =>
                            a.bomId.localeCompare(b.bomId, undefined, {
                              numeric: true
                            })
                          )
                          .map((assembly) => (
                            <li key={assembly.bomId}>
                              <span className="font-medium">
                                {assembly.bomId}
                              </span>{" "}
                              — {assembly.description}
                            </li>
                          ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
                {!eachOutsideOperationHasASupplier && hasOutsideOperations && (
                  <Alert variant="warning">
                    <LuTriangleAlert />
                    <AlertTitle>
                      <Trans>Missing Suppliers</Trans>
                    </AlertTitle>
                    <AlertDescription>
                      <Trans>
                        There are outside operations associated with this job
                        that have no suppliers. Please assign a supplier to each
                        outside operation before releasing it.
                      </Trans>
                    </AlertDescription>
                  </Alert>
                )}
              </VStack>
            </ModalBody>

            <ModalFooter>
              <Button variant="secondary" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>
              <fetcher.Form
                onSubmit={onClose}
                method="post"
                action={`${path.to.jobStatus(job.id!)}?schedule=1`}
              >
                <input type="hidden" name="status" value="Ready" />
                <input
                  type="hidden"
                  name="selectedPurchaseOrdersBySupplierId"
                  value={JSON.stringify(selectedPurchaseOrdersBySupplierId)}
                />
                <input
                  type="hidden"
                  name="selectedSupplierProcessByOperationId"
                  value={JSON.stringify(selectedSupplierProcessByOperationId)}
                />
                <Button
                  isLoading={
                    fetcher.state !== "idle" &&
                    fetcher.formData?.get("status") === "Ready"
                  }
                  isDisabled={
                    fetcher.state !== "idle" ||
                    missingOperationAssemblies.length > 0 ||
                    !eachOutsideOperationHasASupplier
                  }
                  type="submit"
                >
                  <Trans>Release Job</Trans>
                </Button>
              </fetcher.Form>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

function JobCancelModal({
  job,
  onClose,
  fetcher
}: {
  job?: Job;
  fetcher: FetcherWithComponents<{}>;
  onClose: () => void;
}) {
  if (!job) return null;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Cancel</Trans> {job?.jobId}
          </ModalTitle>
        </ModalHeader>
        <ModalBody>
          <Trans>
            Are you sure you want to cancel this job? It will no longer be
            available on the shop floor.
          </Trans>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            <Trans>Don't Cancel</Trans>
          </Button>
          <fetcher.Form
            onSubmit={onClose}
            method="post"
            action={path.to.jobStatus(job.id!)}
          >
            <input type="hidden" name="status" value="Cancelled" />
            <Button variant="destructive" type="submit">
              <Trans>Cancel Job</Trans>
            </Button>
          </fetcher.Form>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function JobExpediteModal({
  job,
  onClose,
  fetcher
}: {
  job?: Job;
  fetcher: FetcherWithComponents<{
    expedite: {
      projectedCompletionAt: string | null;
      cause: string | null;
    } | null;
  }>;
  onClose: () => void;
}) {
  const { t } = useLingui();

  if (!job) return null;

  const loading = fetcher.state !== "idle";
  const expedite = fetcher.data?.expedite;

  const currentProjection = job.projectedCompletionAt
    ? formatDate(job.projectedCompletionAt.slice(0, 10))
    : null;
  const bestCaseProjection = expedite?.projectedCompletionAt
    ? formatDate(expedite.projectedCompletionAt.slice(0, 10))
    : null;

  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <ModalContent>
        <ModalHeader>
          <ModalTitle>
            <Trans>Best case</Trans> {job.jobId}
          </ModalTitle>
          <ModalDescription>
            <Trans>
              Projected completion if this job jumped to the front of its
              location's schedule. Nothing is saved.
            </Trans>
          </ModalDescription>
        </ModalHeader>
        <ModalBody>
          {loading ? (
            <div className="flex flex-col h-[118px] w-full items-center justify-center gap-2">
              <Spinner className="size-8" />
              <p className="text-sm">
                <Trans>Calculating best case…</Trans>
              </p>
            </div>
          ) : expedite ? (
            <VStack spacing={4}>
              <div className="flex items-center justify-between w-full text-sm">
                <span className="text-muted-foreground">
                  <Trans>Current projection</Trans>
                </span>
                <span className="font-medium">
                  {currentProjection ?? t`Not scheduled`}
                </span>
              </div>
              <div className="flex items-center justify-between w-full text-sm">
                <span className="text-muted-foreground">
                  <Trans>Best case projection</Trans>
                </span>
                <span className="font-medium">
                  {bestCaseProjection ?? t`Not scheduled`}
                </span>
              </div>
              {expedite.cause && (
                <Alert>
                  <LuTriangleAlert />
                  <AlertTitle>
                    <Trans>Bottleneck</Trans>
                  </AlertTitle>
                  <AlertDescription>{expedite.cause}</AlertDescription>
                </Alert>
              )}
            </VStack>
          ) : (
            <p className="text-sm text-muted-foreground">
              <Trans>No forecast available for this job.</Trans>
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button onClick={onClose}>
            <Trans>Close</Trans>
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

// What the job has received as of now, from api+/production.job.$jobId.receipts.
// Null when it cannot be read; the dialog then keeps the quantity locked rather
// than offering units it cannot prove are unreceived.
async function getJobReceipts(
  jobId: string
): Promise<JobReceiptSnapshot | null> {
  try {
    const response = await fetch(path.to.api.jobReceipts(jobId));
    if (!response.ok) return null;
    const body = (await response.json()) as {
      receipts: JobReceiptSnapshot | null;
    };
    return body.receipts;
  } catch {
    return null;
  }
}

function JobCompleteModal({
  job,
  onClose,
  fetcher
}: {
  job?: Job;
  fetcher: FetcherWithComponents<{}>;
  onClose: () => void;
}) {
  const { carbon } = useCarbon();
  const [loading, setLoading] = useState(true);
  const { t } = useLingui();
  const [defaultStorageUnitId, setDefaultStorageUnitId] = useState<
    string | undefined
  >(undefined);

  const [quantityComplete, setQuantityComplete] = useState<number>(
    job?.quantityComplete ?? 0
  );
  const [hasTrackedQuantity, setHasTrackedQuantity] = useState<boolean>(false);
  // Serial units the completion can still receive, in the order
  // complete_job_to_inventory receives them. Null when the quantity is not
  // chosen per serial unit.
  const [receivableSerials, setReceivableSerials] = useState<string[] | null>(
    null
  );
  // The completed quantity is cumulative; this much was already received.
  // Refreshed when the dialog opens, since the route's job may be stale.
  const [priorReceivedQuantity, setPriorReceivedQuantity] = useState<number>(
    job?.quantityReceivedToInventory ?? 0
  );
  // complete_job_to_inventory refuses a stocked job below what it received.
  const minimumQuantityComplete =
    job?.itemTrackingType !== "Non-Inventory" ? priorReceivedQuantity : 0;

  // Leftover handling state
  const [leftoverAction, setLeftoverAction] = useState<
    "ship" | "receive" | "split" | "discard" | undefined
  >(undefined);
  const [leftoverShipQuantity, setLeftoverShipQuantity] = useState<number>(0);
  const [leftoverReceiveQuantity, setLeftoverReceiveQuantity] =
    useState<number>(0);

  const makeToOrder = !!job?.salesOrderId && !!job?.salesOrderLineId;
  // Make to Asset: the completion capitalises the job (class) or sweeps its
  // cost onto an asset under construction, so nothing is received to a bin
  // and the location pickers are meaningless. The hidden inputs stay so
  // jobCompleteValidator still sees both fields.
  const completesToFixedAsset = !!(job?.fixedAssetClassId || job?.fixedAssetId);
  const leftoverQuantity = Math.max(0, quantityComplete - (job?.quantity ?? 0));
  const hasLeftover = leftoverQuantity > 0;
  // Serial units are received one at a time; the database refuses a fraction.
  const hasFractionalSerialQuantity =
    receivableSerials !== null &&
    Number.isFinite(quantityComplete) &&
    !Number.isInteger(quantityComplete);

  const getJobData = async () => {
    if (!carbon) return;

    const [pickMethod, makeMethod, receipts] = await Promise.all([
      carbon
        .from("pickMethod")
        .select("*")
        .eq("locationId", job?.locationId!)
        .eq("itemId", job?.itemId!)
        .single(),
      carbon
        .from("jobMakeMethod")
        .select("*")
        .eq("jobId", job?.id!)
        .is("parentMaterialId", null)
        .single(),
      getJobReceipts(job?.id!)
    ]);

    // Read now rather than from the job route: a receipt may have been made
    // since the page loaded. When the read fails, fall back to the route's job
    // and leave the quantity locked below — offering units that may already be
    // received is the one thing this must not do. complete_job_to_inventory
    // enforces both regardless.
    const currentReceivedQuantity =
      receipts?.quantityReceivedToInventory ??
      job?.quantityReceivedToInventory ??
      0;

    if (
      makeMethod.data?.requiresSerialTracking ||
      makeMethod.data?.requiresBatchTracking
    ) {
      const trackedEntities = await carbon
        .from("trackedEntity")
        .select("*")
        .eq("attributes->>Job Make Method", makeMethod.data?.id!)
        .order("createdAt", { ascending: true });

      if (trackedEntities.data?.length) {
        const availableQuantity = trackedEntities.data.reduce((acc, curr) => {
          if (curr.status === "Available") {
            return acc + curr.quantity;
          }
          return acc;
        }, 0);

        const receivedEntityIds = new Set(receipts?.trackedEntityIds ?? []);
        // Only unlock per-serial entry when the receipts are known: without them
        // the list could offer a unit the job already received.
        const serialUnits =
          receipts && makeMethod.data?.requiresSerialTracking
            ? getReceivableSerialUnits(trackedEntities.data, receivedEntityIds)
            : null;

        if (serialUnits) {
          // Every unit already exists as a numbered serial, so the quantity can
          // be chosen here even when nothing was finished on the shop floor.
          setReceivableSerials(serialUnits);
          setHasTrackedQuantity(false);
          setQuantityComplete(
            getDefaultSerialCompleteQuantity({
              finishedUnreceivedQuantity: getFinishedUnreceivedQuantity(
                trackedEntities.data,
                receivedEntityIds
              ),
              jobQuantity: job?.quantity ?? 0,
              priorReceivedQuantity: currentReceivedQuantity,
              receivableSerialCount: serialUnits.length
            })
          );
        } else {
          setQuantityComplete(availableQuantity);
          setHasTrackedQuantity(true);
        }
      }
    }

    setPriorReceivedQuantity(currentReceivedQuantity);

    flushSync(() => {
      setDefaultStorageUnitId(
        pickMethod.data?.defaultStorageUnitId ?? undefined
      );
    });

    setLoading(false);
  };

  useMount(() => {
    if (!job) return;
    getJobData();
  });

  // Update leftover quantities when action changes
  const handleLeftoverActionChange = (
    action: "ship" | "receive" | "split" | "discard"
  ) => {
    setLeftoverAction(action);
    if (action === "ship") {
      setLeftoverShipQuantity(leftoverQuantity);
      setLeftoverReceiveQuantity(0);
    } else if (action === "receive") {
      setLeftoverShipQuantity(0);
      setLeftoverReceiveQuantity(leftoverQuantity);
    } else if (action === "split") {
      // Default to half and half, user can adjust
      const halfQty = Math.floor(leftoverQuantity / 2);
      setLeftoverShipQuantity(halfQty);
      setLeftoverReceiveQuantity(leftoverQuantity - halfQty);
    } else {
      setLeftoverShipQuantity(0);
      setLeftoverReceiveQuantity(0);
    }
  };

  if (!job) return null;

  return (
    <Modal open onOpenChange={onClose}>
      <ModalContent size={hasLeftover ? "large" : "medium"}>
        {loading ? (
          <ModalBody>
            <div className="flex flex-col h-[118px] w-full items-center justify-center gap-2">
              <Spinner className="size-8" />
            </div>
          </ModalBody>
        ) : (
          <ValidatedForm
            method="post"
            action={path.to.jobComplete(job.id!)}
            validator={jobCompleteValidator}
            onSubmit={onClose}
            defaultValues={{
              quantityComplete: job.quantity ?? 0,
              salesOrderId: job.salesOrderId ?? undefined,
              salesOrderLineId: job.salesOrderLineId ?? undefined,
              locationId: job.locationId ?? undefined,
              storageUnitId:
                job.storageUnitId ?? defaultStorageUnitId ?? undefined
            }}
            fetcher={fetcher}
          >
            <ModalHeader>
              <ModalTitle>
                {makeToOrder
                  ? t`Complete Job`
                  : t`Receive ${job.jobId} to Inventory`}
              </ModalTitle>
              <ModalDescription>
                {makeToOrder
                  ? t`This job will no longer be available on the shop floor.`
                  : t`This job will be received to inventory. It will no longer be available on the shop floor.`}
              </ModalDescription>
            </ModalHeader>
            <Hidden name="salesOrderId" />
            <Hidden name="salesOrderLineId" />
            <Hidden name="leftoverAction" value={leftoverAction} />
            <Hidden
              name="leftoverShipQuantity"
              value={leftoverShipQuantity.toString()}
            />
            <Hidden
              name="leftoverReceiveQuantity"
              value={leftoverReceiveQuantity.toString()}
            />
            {(makeToOrder || completesToFixedAsset) && (
              <>
                <Hidden name="locationId" />
                <Hidden name="storageUnitId" />
              </>
            )}
            <ModalBody>
              <VStack spacing={4}>
                {completesToFixedAsset ? (
                  <p className="text-sm text-muted-foreground">
                    {job.fixedAssetClassId
                      ? t`Completes to fixed asset class ${job.fixedAssetClassId}`
                      : t`Sweeps cost to asset ${job.fixedAssetId ?? ""}`}
                  </p>
                ) : (
                  !makeToOrder && (
                    <>
                      <Location
                        name="locationId"
                        label={t`Location`}
                        isReadOnly
                      />
                      <StorageUnit
                        name="storageUnitId"
                        locationId={job.locationId ?? undefined}
                        label={t`Storage Unit`}
                      />
                    </>
                  )
                )}
                <NumberControlled
                  name="quantityComplete"
                  label={t`Quantity Completed`}
                  value={quantityComplete}
                  onChange={(value) => setQuantityComplete(value)}
                  isDisabled={hasTrackedQuantity}
                  minValue={minimumQuantityComplete}
                  maxValue={
                    receivableSerials
                      ? priorReceivedQuantity + receivableSerials.length
                      : undefined
                  }
                  helperText={
                    hasTrackedQuantity
                      ? t`Quantity is derived from completed serials/batches in MES and cannot be edited.`
                      : hasFractionalSerialQuantity
                        ? t`Serial-tracked jobs must be completed in whole units.`
                        : undefined
                  }
                />

                {hasTrackedQuantity && !(quantityComplete > 0) && (
                  <Alert variant="warning">
                    <LuTriangleAlert />
                    <AlertTitle>
                      <Trans>Nothing completed in MES yet</Trans>
                    </AlertTitle>
                    <AlertDescription>
                      <Trans>
                        Complete serials/batches in MES before completing this
                        job, or mark every operation Done to complete it
                        automatically.
                      </Trans>
                    </AlertDescription>
                  </Alert>
                )}

                {receivableSerials &&
                  quantityComplete > priorReceivedQuantity &&
                  !hasFractionalSerialQuantity && (
                    <VStack spacing={1} className="w-full">
                      <span className="text-xs text-muted-foreground">
                        <Trans>Serial numbers received</Trans>
                      </span>
                      <span className="text-sm">
                        {receivableSerials
                          .slice(
                            0,
                            Math.max(
                              quantityComplete - priorReceivedQuantity,
                              0
                            )
                          )
                          .join(", ")}
                      </span>
                    </VStack>
                  )}

                {hasLeftover && (
                  <>
                    <Alert>
                      <LuBlocks />
                      <AlertTitle>
                        <Trans>Leftover Parts Detected</Trans>
                      </AlertTitle>
                      <AlertDescription>
                        {t`You completed ${leftoverQuantity} more 
                        ${leftoverQuantity === 1 ? "part" : "parts"} than the
                        ordered quantity of ${job.quantity}. What would you like
                        to do with the extra parts?`}
                      </AlertDescription>
                    </Alert>

                    <div className="grid grid-cols-2 gap-2 w-full">
                      {makeToOrder && (
                        <Button
                          variant={
                            leftoverAction === "ship" ? "primary" : "secondary"
                          }
                          onClick={() => handleLeftoverActionChange("ship")}
                          type="button"
                          className="h-auto py-3"
                        >
                          <VStack spacing={1}>
                            <span>
                              <Trans>Ship to Customer</Trans>
                            </span>
                            <span className="text-xs opacity-70">
                              <Trans>Include extra parts in shipment</Trans>
                            </span>
                          </VStack>
                        </Button>
                      )}
                      <Button
                        variant={
                          leftoverAction === "receive" ? "primary" : "secondary"
                        }
                        onClick={() => handleLeftoverActionChange("receive")}
                        type="button"
                        className="h-auto py-3"
                      >
                        <VStack spacing={1}>
                          <span>
                            <Trans>Receive to Inventory</Trans>
                          </span>
                          <span className="text-xs opacity-70">
                            <Trans>Add to stock for future use</Trans>
                          </span>
                        </VStack>
                      </Button>
                      {makeToOrder && (
                        <Button
                          variant={
                            leftoverAction === "split" ? "primary" : "secondary"
                          }
                          onClick={() => handleLeftoverActionChange("split")}
                          type="button"
                          className="h-auto py-3"
                        >
                          <VStack spacing={1}>
                            <span>
                              <Trans>Split</Trans>
                            </span>
                            <span className="text-xs opacity-70">
                              <Trans>Ship some, stock some</Trans>
                            </span>
                          </VStack>
                        </Button>
                      )}
                      <Button
                        variant={
                          leftoverAction === "discard" ? "primary" : "secondary"
                        }
                        onClick={() => handleLeftoverActionChange("discard")}
                        type="button"
                        className="h-auto py-3"
                      >
                        <VStack spacing={1}>
                          <span>
                            <Trans>Discard</Trans>
                          </span>
                          <span className="text-xs opacity-70">
                            <Trans>No action needed</Trans>
                          </span>
                        </VStack>
                      </Button>
                    </div>

                    {leftoverAction === "split" && (
                      <HStack className="w-full">
                        <div className="flex-1">
                          <NumberControlled
                            name="leftoverShipQuantity"
                            label={t`Ship to Customer`}
                            value={leftoverShipQuantity}
                            onChange={(value) => {
                              const shipQty = Math.min(value, leftoverQuantity);
                              setLeftoverShipQuantity(shipQty);
                              setLeftoverReceiveQuantity(
                                leftoverQuantity - shipQty
                              );
                            }}
                            minValue={0}
                            maxValue={leftoverQuantity}
                          />
                        </div>
                        <div className="flex-1">
                          <NumberControlled
                            name="leftoverReceiveQuantity"
                            label={t`Receive to Inventory`}
                            value={leftoverReceiveQuantity}
                            onChange={(value) => {
                              const receiveQty = Math.min(
                                value,
                                leftoverQuantity
                              );
                              setLeftoverReceiveQuantity(receiveQty);
                              setLeftoverShipQuantity(
                                leftoverQuantity - receiveQty
                              );
                            }}
                            minValue={0}
                            maxValue={leftoverQuantity}
                          />
                        </div>
                      </HStack>
                    )}
                  </>
                )}
              </VStack>
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={onClose}>
                <Trans>Cancel</Trans>
              </Button>

              <Button
                type="submit"
                isDisabled={
                  (hasLeftover && !leftoverAction) ||
                  // Completing a stocked item at zero receives nothing and
                  // consumes nothing; the database refuses it as well.
                  (job.itemTrackingType !== "Non-Inventory" &&
                    !(quantityComplete > 0)) ||
                  hasFractionalSerialQuantity
                }
              >
                <Trans>Complete Job</Trans>
              </Button>
            </ModalFooter>
          </ValidatedForm>
        )}
      </ModalContent>
    </Modal>
  );
}
