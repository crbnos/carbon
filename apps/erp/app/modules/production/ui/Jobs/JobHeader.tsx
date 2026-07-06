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
  useDisclosure,
  useMount,
  VStack
} from "@carbon/react";
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
  LuPackage,
  LuPanelLeft,
  LuPanelRight,
  LuQrCode,
  LuSettings,
  LuShoppingCart,
  LuSquareSigma,
  LuTable,
  LuTrash,
  LuTriangleAlert,
  LuWorkflow
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
import { generateBomIds } from "~/utils/bom";
import { path } from "~/utils/path";
import { isJobLocked, jobCompleteValidator } from "../../production.models";
import { getJobMethodTree } from "../../production.service";
import type { Job } from "../../types";
import JobStatus from "./JobStatus";

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
  const routeData = useRouteData<{ job: Job }>(path.to.job(jobId));

  const statusFetcher = useFetcher<{}>();
  const status = routeData?.job?.status;

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

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between p-2 bg-background border-b h-[50px] overflow-x-auto scrollbar-hide ">
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
            </>
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
      return <LuPackage />;
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

  const validate = async () => {
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
      operations.data?.filter((op) => op.operationType === "Outside") || [];
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

    // Filter out operations that already have purchase order lines
    const operationsNeedingPurchaseOrders = outsideOperations.filter(
      (op) =>
        !existingJobOperationIds.has(op.id) && op.operationSupplierProcessId
    );

    const uniqueOutsideProcessIds = operationsNeedingPurchaseOrders.map(
      (op) => op.operationSupplierProcessId!
    );

    const supplierProcesses =
      uniqueOutsideProcessIds.length > 0
        ? await carbon
            .from("supplierProcess")
            .select("supplierId")
            .in("id", uniqueOutsideProcessIds)
        : { data: [] };

    const uniqueSupplierIds = new Set(
      supplierProcesses.data?.map((sp) => sp.supplierId) ?? []
    );

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

    setSelectedPurchaseOrdersBySupplierId(
      Array.from(uniqueSupplierIds).reduce<Record<string, string>>(
        (acc, supplierId) => {
          acc[supplierId] = "new";
          return acc;
        },
        {}
      )
    );

    const kittedMakeMethodIds = new Set(
      materials.data
        ?.filter((m) => m.jobMaterialMakeMethodId && m.kit)
        .map((m) => m.jobMaterialMakeMethodId) ?? []
    );

    // make methods for materials
    const uniqueMakeMethodIds = new Set(
      materials.data
        ?.filter(
          (m) =>
            m.jobMaterialMakeMethodId &&
            m.methodType === "Make to Order" &&
            !kittedMakeMethodIds.has(m.jobMaterialMakeMethodId)
        )
        .map((m) => m.jobMaterialMakeMethodId) ?? []
    );

    // top-level make method
    uniqueMakeMethodIds.add(makeMethod.data?.id!);

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

    const missingAssemblies = Array.from(uniqueMakeMethodIds)
      .filter(
        (makeMethodId) =>
          !(
            operations.data?.some(
              (op) => op.jobMakeMethodId === makeMethodId
            ) ?? false
          )
      )
      .map((makeMethodId) => {
        const info = bomInfoByMakeMethodId.get(makeMethodId ?? "");
        return info
          ? { bomId: info.bomId, description: info.description }
          : { bomId: "?", description: makeMethodId ?? "Unknown" };
      });

    flushSync(() => {
      setMissingOperationAssemblies(missingAssemblies);

      // Only show purchase order UI if there are outside operations that need purchase orders
      setHasOutsideOperations(operationsNeedingPurchaseOrders.length > 0);

      // Check if all outside operations that need purchase orders have suppliers
      setEachOutsideOperationHasASupplier(
        operationsNeedingPurchaseOrders.length === 0 ||
          operationsNeedingPurchaseOrders.every(
            (op) => op.operationSupplierProcessId !== null
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

  // Leftover handling state
  const [leftoverAction, setLeftoverAction] = useState<
    "ship" | "receive" | "split" | "discard" | undefined
  >(undefined);
  const [leftoverShipQuantity, setLeftoverShipQuantity] = useState<number>(0);
  const [leftoverReceiveQuantity, setLeftoverReceiveQuantity] =
    useState<number>(0);

  const makeToOrder = !!job?.salesOrderId && !!job?.salesOrderLineId;
  const leftoverQuantity = Math.max(0, quantityComplete - (job?.quantity ?? 0));
  const hasLeftover = leftoverQuantity > 0;

  const getJobData = async () => {
    if (!carbon) return;

    const [pickMethod, makeMethod] = await Promise.all([
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
        .single()
    ]);

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

        setQuantityComplete(availableQuantity);
        setHasTrackedQuantity(true);
      }
    }

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
            {makeToOrder && (
              <>
                <Hidden name="locationId" />
                <Hidden name="storageUnitId" />
              </>
            )}
            <ModalBody>
              <VStack spacing={4}>
                {!makeToOrder && (
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
                )}
                <NumberControlled
                  name="quantityComplete"
                  label={t`Quantity Completed`}
                  value={quantityComplete}
                  onChange={(value) => setQuantityComplete(value)}
                  isDisabled={hasTrackedQuantity}
                  helperText={
                    hasTrackedQuantity
                      ? t`Quantity is derived from completed serials/batches in MES and cannot be edited.`
                      : undefined
                  }
                />

                {hasLeftover && (
                  <>
                    <Alert>
                      <LuPackage />
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

              <Button type="submit" isDisabled={hasLeftover && !leftoverAction}>
                <Trans>Complete Job</Trans>
              </Button>
            </ModalFooter>
          </ValidatedForm>
        )}
      </ModalContent>
    </Modal>
  );
}
