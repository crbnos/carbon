import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HStack,
  Heading,
} from "@carbon/react";

import { Link, useNavigate, useParams } from "@remix-run/react";
import {
  LuChevronDown,
  LuClock,
  LuHardHat,
  LuList,
  LuPackage,
  LuSettings,
  LuTable,
} from "react-icons/lu";
import { RiProgress8Line } from "react-icons/ri";
import { Assignee, Copy, useOptimisticAssignment } from "~/components";
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

  const routeData = useRouteData<{ job: Job }>(path.to.job(jobId));
  const optimisticAssignment = useOptimisticAssignment({
    id: jobId,
    table: "job",
  });
  const assignee =
    optimisticAssignment !== undefined
      ? optimisticAssignment
      : routeData?.job?.assignee;

  const getExplorePath = (type: string) => {
    switch (type) {
      case "materials":
        return path.to.jobMaterials(jobId);
      case "operations":
        return path.to.jobOperations(jobId);
      case "timecards":
        return path.to.jobTimecards(jobId);
      default:
        return path.to.jobDetails(jobId);
    }
  };

  const getOptionFromPath = () => {
    if (location.pathname.includes(path.to.jobMaterials(jobId)))
      return "materials";
    if (location.pathname.includes(path.to.jobOperations(jobId)))
      return "operations";
    if (location.pathname.includes(path.to.jobTimecards(jobId)))
      return "timecards";
    return "details";
  };

  const currentValue = getOptionFromPath();

  return (
    <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border shadow-md">
      <HStack>
        <Link to={path.to.jobDetails(jobId)}>
          <Heading size="h2" className="flex items-center gap-1">
            <LuHardHat className="text-primary" />
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
        {routeData?.job?.salesOrderId && routeData?.job.salesOrderLineId && (
          <Button leftIcon={<RiProgress8Line />} variant="secondary" asChild>
            <Link
              to={path.to.salesOrderLine(
                routeData?.job?.salesOrderId,
                routeData?.job?.salesOrderLineId
              )}
            >
              View Order
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
              onValueChange={(option) => navigate(getExplorePath(option))}
            >
              <DropdownMenuRadioItem value="details">
                <DropdownMenuIcon icon={getExplorerMenuIcon("details")} />
                {getExplorerLabel("details")}
              </DropdownMenuRadioItem>
              <DropdownMenuSeparator />
              {["materials", "operations", "timecards"].map((i) => (
                <DropdownMenuRadioItem value={i} key={i}>
                  <DropdownMenuIcon icon={getExplorerMenuIcon(i)} />
                  {getExplorerLabel(i)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </HStack>
    </div>
  );
};

export default JobHeader;

function getExplorerLabel(type: string) {
  switch (type) {
    case "materials":
      return "Materials";
    case "operations":
      return "Operations";
    case "timecards":
      return "Timecards";
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
    case "timecards":
      return <LuClock />;
    default:
      return <LuHardHat />;
  }
}
