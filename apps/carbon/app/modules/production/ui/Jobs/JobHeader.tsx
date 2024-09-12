import { Badge, HStack, Heading, VStack } from "@carbon/react";

import { Link, useParams } from "@remix-run/react";
import { useRouteData } from "~/hooks";
import { MethodItemTypeIcon } from "~/modules/shared";
import { path } from "~/utils/path";
import type { Job } from "../../types";

const JobHeader = () => {
  // const links = useJobavigation();
  const { jobId } = useParams();
  if (!jobId) throw new Error("jobId not found");

  const routeData = useRouteData<{ job: Job }>(path.to.job(jobId));

  return (
    <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border">
      <VStack spacing={0} className="flex-grow">
        <HStack>
          <Link to={path.to.jobDetails(jobId)}>
            <Heading size="h2">{routeData?.job?.jobId}</Heading>
          </Link>
          <Badge variant="secondary">
            <MethodItemTypeIcon type="Job" />
          </Badge>
        </HStack>
      </VStack>
      <VStack spacing={0} className="flex-shrink justify-center items-end">
        {/* <DetailsTopbar links={links} /> */}
      </VStack>
    </div>
  );
};

export default JobHeader;
