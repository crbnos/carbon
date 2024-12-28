import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
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
  VStack,
  useDisclosure,
  useMount,
} from "@carbon/react";

import { useCarbon } from "@carbon/auth";
import { Hidden, Number, ValidatedForm } from "@carbon/form";
import type { FetcherWithComponents } from "@remix-run/react";
import { Link, useFetcher, useNavigate, useParams } from "@remix-run/react";
import { useState } from "react";
import { flushSync } from "react-dom";
import {
  LuAlertTriangle,
  LuCheckCircle,
  LuChevronDown,
  LuClock,
  LuHardHat,
  LuList,
  LuPackage,
  LuPanelLeft,
  LuPanelRight,
  LuPauseCircle,
  LuPlayCircle,
  LuRefreshCw,
  LuSettings,
  LuSigmaSquare,
  LuStopCircle,
  LuTable,
} from "react-icons/lu";
import { RiProgress8Line } from "react-icons/ri";
import { Location, Shelf } from "~/components/Form";
import { usePanels } from "~/components/Layout";
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

  return (
    <>
      <div className="flex flex-shrink-0 items-center justify-between p-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide">
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
          <JobStatus status={routeData?.job?.status} />
        </HStack>
        <HStack>
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
              {routeData?.job?.salesOrderId &&
                routeData?.job.salesOrderLineId && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link
                        to={path.to.salesOrderLine(
                          routeData?.job?.salesOrderId,
                          routeData?.job?.salesOrderLineId
                        )}
                      >
                        <DropdownMenuIcon icon={<RiProgress8Line />} />
                        Sales Order
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}
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
                leftIcon={<LuPauseCircle />}
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
                leftIcon={<LuPlayCircle />}
                type="submit"
              >
                Resume
              </Button>
            </statusFetcher.Form>
          )}

          <Button
            onClick={releaseModal.onOpen}
            isLoading={
              statusFetcher.state !== "idle" &&
              statusFetcher.formData?.get("status") === "Ready"
            }
            isDisabled={
              status !== "Draft" ||
              statusFetcher.state !== "idle" ||
              !permissions.can("update", "production") ||
              (routeData?.job?.quantity === 0 &&
                routeData?.job?.scrapQuantity === 0)
            }
            leftIcon={<LuPlayCircle />}
            variant={status === "Draft" ? "primary" : "secondary"}
          >
            Release
          </Button>

          <Button
            onClick={completeModal.onOpen}
            isLoading={
              statusFetcher.state !== "idle" &&
              statusFetcher.formAction === path.to.jobComplete(jobId)
            }
            isDisabled={
              ["Completed", "Cancelled", "Draft"].includes(status ?? "") ||
              statusFetcher.state !== "idle" ||
              !permissions.can("update", "production")
            }
            leftIcon={<LuCheckCircle />}
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
            leftIcon={<LuStopCircle />}
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
                ["Draft", "In Progress"].includes(
                  (statusFetcher.formData?.get("status") as string) ?? ""
                )
              }
              isDisabled={
                !["Cancelled", "Completed"].includes(status ?? "") ||
                statusFetcher.state !== "idle" ||
                !permissions.can("update", "production")
              }
              leftIcon={<LuRefreshCw />}
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
      return <LuSigmaSquare />;
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

function JobStartModal({
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

    // make methods for materials
    const uniqueMakeMethodIds = new Set(
      materials.data
        ?.filter((m) => m.jobMaterialMakeMethodId && m.methodType === "Make")
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
      <ModalContent>
        <ModalHeader>
          <ModalTitle>Start {job?.jobId}</ModalTitle>
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
              {eachAssemblyHasAnOperation ? (
                <p>
                  Are you sure you want to start this job? It will become
                  available to the shop floor.
                </p>
              ) : (
                <Alert variant="warning">
                  <LuAlertTriangle />
                  <AlertTitle>Missing Operations</AlertTitle>
                  <AlertDescription>
                    There are Bills of Processes associated with this job that
                    have no operations. Please assign an operation to each make
                    method before releasing it.
                  </AlertDescription>
                </Alert>
              )}
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
                <Button
                  isLoading={
                    fetcher.state !== "idle" &&
                    fetcher.formData?.get("status") === "Ready"
                  }
                  isDisabled={
                    fetcher.state !== "idle" || !eachAssemblyHasAnOperation
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

  const makeToOrder = !!job?.salesOrderId && !!job?.salesOrderLineId;

  const getDefaultShelf = async () => {
    if (!carbon) return;

    const pickMethod = await carbon
      .from("pickMethod")
      .select("*")
      .eq("locationId", job?.locationId!)
      .eq("itemId", job?.itemId!)
      .single();

    flushSync(() => {
      setDefaultShelfId(pickMethod.data?.defaultShelfId ?? undefined);
    });

    setLoading(false);
  };

  useMount(() => {
    if (!job) return;
    if (!makeToOrder) {
      getDefaultShelf();
    } else {
      setLoading(false);
    }
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
              shelfId: defaultShelfId ?? undefined,
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
                <Number name="quantityComplete" label="Quantity Completed" />
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
