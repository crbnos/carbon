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
  HStack,
  Heading,
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
  VStack,
  useDisclosure,
  useMount,
} from "@carbon/react";

import { useCarbon } from "@carbon/auth";
import { Hidden, NumberControlled, ValidatedForm } from "@carbon/form";
import {
  getLocalTimeZone,
  isSameDay,
  parseDate,
  today,
} from "@internationalized/date";
import type { FetcherWithComponents } from "@remix-run/react";
import { Link, useFetcher, useNavigate, useParams } from "@remix-run/react";
import { useMemo, useState } from "react";
import { flushSync } from "react-dom";
import {
  LuCheckCheck,
  LuChevronDown,
  LuCircleCheck,
  LuCirclePause,
  LuCirclePlay,
  LuCircleStop,
  LuClock,
  LuEllipsisVertical,
  LuHardHat,
  LuList,
  LuLoaderCircle,
  LuPackage,
  LuPanelLeft,
  LuPanelRight,
  LuSettings,
  LuShoppingCart,
  LuSquareSigma,
  LuTable,
  LuTrash,
  LuTriangleAlert,
} from "react-icons/lu";
import { RiProgress8Line } from "react-icons/ri";
import { Location, Shelf } from "~/components/Form";
import { usePanels } from "~/components/Layout";
import ConfirmDelete from "~/components/Modals/ConfirmDelete";
import Select from "~/components/Select";
import SupplierAvatar from "~/components/SupplierAvatar";
import { useOptimisticLocation, usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import { jobCompleteValidator } from "../../production.models";
import type { Job } from "../../types";
import JobStatus from "./JobStatus";

const JobHeader = () => {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const { jobId } = useParams();
  if (!jobId) throw new Error("jobId not found");

  const location = useOptimisticLocation();
  const { toggleExplorer, toggleProperties } = usePanels();

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
    if (location.pathname.includes(path.to.jobProductionEvents(jobId)))
      return "events";
    if (location.pathname.includes(path.to.jobProductionQuantities(jobId)))
      return "quantities";
    return "details";
  };

  const currentValue = getOptionFromPath(jobId);

  const markAsPlanned = () => {
    statusFetcher.submit(
      {
        status: "Planned",
      },
      { method: "post", action: path.to.jobStatus(jobId) }
    );
  };

  const todaysDate = useMemo(() => today(getLocalTimeZone()), []);

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between p-2 bg-card border-b h-[50px] overflow-x-auto scrollbar-hide ">
        <HStack>
          <IconButton
            aria-label="Toggle Explorer"
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
                aria-label="More options"
                icon={<LuEllipsisVertical />}
                variant="secondary"
                size="sm"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                disabled={
                  !permissions.can("delete", "production") ||
                  !permissions.is("employee")
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
                {["materials", "operations"].map((i) => (
                  <DropdownMenuRadioItem value={i} key={i}>
                    <DropdownMenuIcon icon={getExplorerMenuIcon(i)} />
                    {getExplorerLabel(i)}
                  </DropdownMenuRadioItem>
                ))}
                <DropdownMenuSeparator />
                {["events", "quantities"].map((i) => (
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
              ["Ready", "Planned"].includes(status ?? "")
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
                label: "Mark as Planned",
                icon: <LuCheckCheck />,
                onClick: markAsPlanned,
              },
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
          <statusFetcher.Form method="post" action={path.to.jobStatus(jobId)}>
            <input
              type="hidden"
              name="status"
              value={status === "Cancelled" ? "Draft" : "In Progress"}
            />
            <Button
              isLoading={
                statusFetcher.state !== "idle" &&
                ["Draft", "Planned", "In Progress"].includes(
                  (statusFetcher.formData?.get("status") as string) ?? ""
                )
              }
              isDisabled={
                !["Cancelled", "Completed"].includes(status ?? "") ||
                statusFetcher.state !== "idle" ||
                !permissions.can("update", "production")
              }
              leftIcon={<LuLoaderCircle />}
              type="submit"
              variant="secondary"
            >
              Reopen
            </Button>
          </statusFetcher.Form>

          <IconButton
            aria-label="Toggle Properties"
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
    </>
  );
};

export default JobHeader;

function getExplorerLabel(type: string) {
  switch (type) {
    case "materials":
      return "Materials";
    case "operations":
      return "Operations";
    case "events":
      return "Production Events";
    case "quantities":
      return "Production Quantities";
    default:
      return "Job";
  }
}

function getExplorerMenuIcon(type: string) {
  switch (type) {
    case "materials":
      return <LuPackage />;
    case "operations":
      return <LuSettings />;
    case "events":
      return <LuClock />;
    case "quantities":
      return <LuSquareSigma />;
    default:
      return <LuHardHat />;
  }
}

const getExplorePath = (jobId: string, type: string) => {
  switch (type) {
    case "materials":
      return path.to.jobMaterials(jobId);
    case "operations":
      return path.to.jobOperations(jobId);
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
  fetcher,
}: {
  job?: Job;
  fetcher: FetcherWithComponents<{}>;
  onClose: () => void;
}) {
  const { carbon } = useCarbon();
  const [loading, setLoading] = useState(true);
  const [eachAssemblyHasAnOperation, setEachAssemblyHasAnOperation] =
    useState(false);
  const [
    eachOutsideOperationHasASupplier,
    setEachOutsideOperationHasASupplier,
  ] = useState(false);
  const [hasOutsideOperations, setHasOutsideOperations] = useState(false);
  const [
    existingPurchaseOrdersBySupplierId,
    setExistingPurchaseOrdersBySupplierId,
  ] = useState<Record<string, { id: string; purchaseOrderId: string }[]>>({});
  const [
    selectedPurchaseOrdersBySupplierId,
    setSelectedPurchaseOrdersBySupplierId,
  ] = useState<Record<string, string>>({});

  const validate = async () => {
    if (!carbon || !job) return;
    const [makeMethod, materials, operations] = await Promise.all([
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
    ]);

    const uniqueOutsideProcessIds =
      operations.data?.reduce<string[]>((acc, op) => {
        if (op.operationType === "Outside" && op.operationSupplierProcessId) {
          acc.push(op.operationSupplierProcessId);
        }
        return acc;
      }, []) || [];

    const supplierProcesses = await carbon
      .from("supplierProcess")
      .select("supplierId")
      .in("id", uniqueOutsideProcessIds);

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
            purchaseOrderId: po.purchaseOrderId,
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
            m.methodType === "Make" &&
            !kittedMakeMethodIds.has(m.jobMaterialMakeMethodId)
        )
        .map((m) => m.jobMaterialMakeMethodId) ?? []
    );

    // top-level make method
    uniqueMakeMethodIds.add(makeMethod.data?.id!);

    flushSync(() => {
      setEachAssemblyHasAnOperation(
        Array.from(uniqueMakeMethodIds).every(
          (makeMethodId) =>
            operations.data?.some(
              (op) => op.jobMakeMethodId === makeMethodId
            ) ?? false
        )
      );

      setHasOutsideOperations(
        Array.isArray(operations?.data) &&
          operations.data.length > 0 &&
          operations.data.some((op) => op.operationType === "Outside")
      );

      setEachOutsideOperationHasASupplier(
        operations.data?.every(
          (op) =>
            op.operationType === "Inside" ||
            op.operationSupplierProcessId !== null
        ) ?? false
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
          <ModalTitle>Release Job {job?.jobId}</ModalTitle>
          {eachAssemblyHasAnOperation && eachOutsideOperationHasASupplier && (
            <ModalDescription>
              Are you sure you want to release this job? It will become
              available to the shop floor, and drive purchasing and production.
            </ModalDescription>
          )}
        </ModalHeader>
        {loading ? (
          <ModalBody>
            <div className="flex flex-col h-[118px] w-full items-center justify-center gap-2">
              <Spinner className="size-8" />
              <p className="text-sm">Validating job...</p>
            </div>
          </ModalBody>
        ) : (
          <>
            <ModalBody>
              <VStack>
                {hasOutsideOperations && eachOutsideOperationHasASupplier && (
                  <>
                    <Alert>
                      <LuShoppingCart />
                      <AlertTitle>Purchase orders required</AlertTitle>
                      <AlertDescription>
                        A new purchase order will be created for each supplier.
                        Alternatively, you can choose an existing draft purchase
                        order for the supplier to add the outside operations to.
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
                                  label: "Create New",
                                },
                                ...purchaseOrders.map((po) => ({
                                  label: po.purchaseOrderId,
                                  value: po.id,
                                })),
                              ]}
                              onChange={(value) => {
                                setSelectedPurchaseOrdersBySupplierId(
                                  (prev) => ({
                                    ...prev,
                                    [supplierId]: value,
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
                {!eachAssemblyHasAnOperation && (
                  <Alert variant="warning">
                    <LuTriangleAlert />
                    <AlertTitle>Missing Operations</AlertTitle>
                    <AlertDescription>
                      There are Bills of Processes associated with this job that
                      have no operations. Please assign an operation to each
                      make method before releasing it.
                    </AlertDescription>
                  </Alert>
                )}
                {!eachOutsideOperationHasASupplier && (
                  <Alert variant="warning">
                    <LuTriangleAlert />
                    <AlertTitle>Missing Suppliers</AlertTitle>
                    <AlertDescription>
                      There are outside operations associated with this job that
                      have no suppliers. Please assign a supplier to each
                      outside operation before releasing it.
                    </AlertDescription>
                  </Alert>
                )}
              </VStack>
            </ModalBody>

            <ModalFooter>
              <Button variant="secondary" onClick={onClose}>
                Cancel
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
                    !eachAssemblyHasAnOperation ||
                    !eachOutsideOperationHasASupplier
                  }
                  type="submit"
                >
                  Release Job
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
  fetcher,
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
          <ModalTitle>Cancel {job?.jobId}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          Are you sure you want to cancel this job? It will no longer be
          available on the shop floor.
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={onClose}>
            Don't Cancel
          </Button>
          <fetcher.Form
            onSubmit={onClose}
            method="post"
            action={path.to.jobStatus(job.id!)}
          >
            <input type="hidden" name="status" value="Cancelled" />
            <Button variant="destructive" type="submit">
              Cancel Job
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
  fetcher,
}: {
  job?: Job;
  fetcher: FetcherWithComponents<{}>;
  onClose: () => void;
}) {
  const { carbon } = useCarbon();
  const [loading, setLoading] = useState(true);
  const [defaultShelfId, setDefaultShelfId] = useState<string | undefined>(
    undefined
  );

  const [quantityComplete, setQuantityComplete] = useState<number>(
    job?.quantity ?? 0
  );
  const [hasTrackedQuantity, setHasTrackedQuantity] = useState<boolean>(false);

  const makeToOrder = !!job?.salesOrderId && !!job?.salesOrderLineId;

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
        .single(),
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
      setDefaultShelfId(pickMethod.data?.defaultShelfId ?? undefined);
    });

    setLoading(false);
  };

  useMount(() => {
    if (!job) return;
    getJobData();
  });

  if (!job) return null;

  return (
    <Modal open onOpenChange={onClose}>
      <ModalContent>
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
              shelfId: job.shelfId ?? defaultShelfId ?? undefined,
            }}
            fetcher={fetcher}
          >
            <ModalHeader>
              <ModalTitle>
                {makeToOrder
                  ? `Complete Job`
                  : `Receive ${job.jobId} to Inventory`}
              </ModalTitle>
              <ModalDescription>
                {makeToOrder
                  ? `This job will no longer be available on the shop floor.`
                  : "This job will be received to inventory. It will no longer be available on the shop floor."}
              </ModalDescription>
            </ModalHeader>
            <Hidden name="salesOrderId" />
            <Hidden name="salesOrderLineId" />
            {makeToOrder && (
              <>
                <Hidden name="locationId" />
                <Hidden name="shelfId" />
              </>
            )}
            <ModalBody>
              <VStack spacing={4}>
                {!makeToOrder && (
                  <>
                    <Location name="locationId" label="Location" isReadOnly />
                    <Shelf
                      name="shelfId"
                      locationId={job.locationId ?? undefined}
                      label="Shelf"
                    />
                  </>
                )}
                <NumberControlled
                  name="quantityComplete"
                  label="Quantity Completed"
                  value={quantityComplete}
                  onChange={(value) => setQuantityComplete(value)}
                  isReadOnly={hasTrackedQuantity}
                />
              </VStack>
            </ModalBody>
            <ModalFooter>
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>

              <Button type="submit">Complete Job</Button>
            </ModalFooter>
          </ValidatedForm>
        )}
      </ModalContent>
    </Modal>
  );
}
