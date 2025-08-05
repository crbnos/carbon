import { Button, Copy, HStack, Heading, VStack } from "@carbon/react";

import { Link, useFetcher, useParams } from "@remix-run/react";
import {
  LuCircleCheck,
  LuCirclePlay,
  LuFile,
  LuLoaderCircle,
} from "react-icons/lu";
import { DetailsTopbar } from "~/components/Layout";
import { usePermissions, useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { Issue } from "../../types";
import IssueStatus from "./IssueStatus";
import { useIssueNavigation } from "./useIssueNavigation";

const IssueHeader = () => {
  const links = useIssueNavigation();
  const { id } = useParams();
  if (!id) throw new Error("id not found");

  const routeData = useRouteData<{ nonConformance: Issue }>(path.to.issue(id));

  const status = routeData?.nonConformance?.status;
  const permissions = usePermissions();
  const statusFetcher = useFetcher<{}>();

  return (
    <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border h-[50px] overflow-x-auto scrollbar-hide dark:border-none dark:shadow-[inset_0_0_1px_rgb(255_255_255_/_0.24),_0_0_0_0.5px_rgb(0,0,0,1),0px_0px_4px_rgba(0,_0,_0,_0.08)]">
      <VStack spacing={0}>
        <HStack>
          <Link to={path.to.issueDetails(id)}>
            <Heading size="h4" className="flex items-center gap-2">
              {/* <ModuleIcon icon={<MethodItemTypeIcon type="Part" />} /> */}
              <span>{routeData?.nonConformance?.nonConformanceId}</span>
            </Heading>
          </Link>
          <IssueStatus status={status} />
          <Copy text={routeData?.nonConformance?.nonConformanceId ?? ""} />
        </HStack>
      </VStack>

      <HStack>
        <DetailsTopbar links={links} />
        <Button
          variant="secondary"
          leftIcon={<LuFile />}
          isDisabled={status !== "Closed"}
          asChild
        >
          <a
            href={path.to.file.nonConformance(id)}
            target="_blank"
            rel="noreferrer"
          >
            Report
          </a>
        </Button>
        <statusFetcher.Form method="post" action={path.to.issueStatus(id)}>
          <input type="hidden" name="status" value="In Progress" />
          <Button
            type="submit"
            leftIcon={<LuCirclePlay />}
            variant={status === "Registered" ? "primary" : "secondary"}
            isDisabled={
              status !== "Registered" ||
              statusFetcher.state !== "idle" ||
              !permissions.can("update", "quality")
            }
            isLoading={
              statusFetcher.state !== "idle" &&
              statusFetcher.formData?.get("status") === "In Progress"
            }
          >
            Start
          </Button>
        </statusFetcher.Form>

        <statusFetcher.Form method="post" action={path.to.issueStatus(id)}>
          <input type="hidden" name="status" value="Closed" />
          <Button
            type="submit"
            leftIcon={<LuCircleCheck />}
            variant={status === "In Progress" ? "primary" : "secondary"}
            isDisabled={
              status !== "In Progress" ||
              statusFetcher.state !== "idle" ||
              !permissions.can("update", "quality")
            }
            isLoading={
              statusFetcher.state !== "idle" &&
              statusFetcher.formData?.get("status") === "Closed"
            }
          >
            Complete
          </Button>
        </statusFetcher.Form>

        <statusFetcher.Form method="post" action={path.to.issueStatus(id)}>
          <input type="hidden" name="status" value="Registered" />
          <Button
            type="submit"
            leftIcon={<LuLoaderCircle />}
            variant={status === "Closed" ? "primary" : "secondary"}
            isDisabled={
              !["In Progress", "Closed"].includes(status ?? "") ||
              statusFetcher.state !== "idle" ||
              !permissions.can("update", "quality")
            }
          >
            Reopen
          </Button>
        </statusFetcher.Form>
      </HStack>
    </div>
  );
};

export default IssueHeader;
