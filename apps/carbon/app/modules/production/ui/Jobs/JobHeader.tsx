import {
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
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  useDisclosure,
} from "@carbon/react";

import type { FetcherWithComponents } from "@remix-run/react";
import { Link, useFetcher, useNavigate, useParams } from "@remix-run/react";
import {
  LuChevronDown,
  LuClock,
  LuHardHat,
  LuList,
  LuPackage,
  LuPauseCircle,
  LuPlayCircle,
  LuRefreshCw,
  LuSettings,
  LuSigmaSquare,
  LuStopCircle,
  LuTable,
} from "react-icons/lu";
import { RiProgress8Line } from "react-icons/ri";
import {
  Assignee,
  Copy,
  ModuleIcon,
  useOptimisticAssignment,
} from "~/components";
import { useOptimisticLocation, usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { Job } from "../../types";
import JobStatus from "./JobStatus";

const JobHeader = () => {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const { jobId } = useParams();
  if (!jobId) throw new Error("jobId not found");

  const location = useOptimisticLocation();

  const releaseModal = useDisclosure();
  const cancelModal = useDisclosure();

  const routeData = useRouteData<{ job: Job }>(path.to.job(jobId));
  const optimisticAssignment = useOptimisticAssignment({
    id: jobId,
    table: "job",
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.job?.assignee;

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
      <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border shadow-md">
        <HStack>
          <Link to={path.to.jobDetails(jobId)}>
            <Heading size="h3" className="flex items-center gap-2">
              <ModuleIcon icon={<LuHardHat />} />
              <span>{routeData?.job?.jobId}</span>
            </Heading>
          </Link>
          <Copy text={routeData?.job?.jobId ?? ""} />
          <JobStatus status={routeData?.job?.status} />
        </HStack>
        <HStack>
          <Assignee
            id={jobId}
            table="job"
            value={assignee ?? ""}
            className="h-8"
            isReadOnly={!permissions.can("update", "production")}
          />

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

          {["Cancelled", "Completed"].includes(status ?? "") && (
            <>
              <statusFetcher.Form
                method="post"
                action={path.to.jobStatus(jobId)}
              >
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
            </>
          )}

          {!["Cancelled", "Completed"].includes(status ?? "") && (
            <Button
              onClick={cancelModal.onOpen}
              isLoading={
                statusFetcher.state !== "idle" &&
                statusFetcher.formData?.get("status") === "Cancelled"
              }
              isDisabled={
                statusFetcher.state !== "idle" ||
                !permissions.can("update", "production")
              }
              leftIcon={<LuStopCircle />}
              variant="secondary"
            >
              Cancel
            </Button>
          )}

          {["Ready", "In Progress"].includes(status ?? "") && (
            <statusFetcher.Form method="post" action={path.to.jobStatus(jobId)}>
              <input type="hidden" name="status" value="Paused" />
              <Button
                isLoading={
                  statusFetcher.state !== "idle" &&
                  statusFetcher.formData?.get("status") === "Paused"
                }
                isDisabled={
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
          )}

          {status === "Paused" && (
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

          {status === "Draft" && (
            <>
              <Button
                onClick={releaseModal.onOpen}
                isLoading={
                  statusFetcher.state !== "idle" &&
                  statusFetcher.formData?.get("status") === "Ready"
                }
                isDisabled={
                  statusFetcher.state !== "idle" ||
                  !permissions.can("update", "production") ||
                  (routeData?.job?.quantity === 0 &&
                    routeData?.job?.scrapQuantity === 0)
                }
                leftIcon={<LuPlayCircle />}
              >
                Start
              </Button>
            </>
          )}
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
        <ModalBody>
          Are you sure you want to start this job? It will become available to
          the shop floor.
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
              isLoading={fetcher.state !== "idle"}
              isDisabled={fetcher.state !== "idle"}
              type="submit"
            >
              Start
            </Button>
          </fetcher.Form>
        </ModalFooter>
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
