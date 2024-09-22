import { HStack, Heading, VStack } from "@carbon/react";

import { Link, useParams } from "@remix-run/react";
import { LuHardHat } from "react-icons/lu";
import { Copy } from "~/components";
import { useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import type { Job } from "../../types";

const JobHeader = () => {
  // const links = useJobavigation();
  const { jobId } = useParams();
  if (!jobId) throw new Error("jobId not found");

  const routeData = useRouteData<{ job: Job }>(path.to.job(jobId));

  return (
    <div className="flex flex-shrink-0 items-center justify-between px-4 py-2 bg-card border-b border-border shadow-md">
      <VStack spacing={0} className="flex-grow">
        <HStack>
          <Link to={path.to.jobDetails(jobId)}>
            <Heading size="h2" className="flex items-center gap-1">
              <LuHardHat />
              <span>{routeData?.job?.jobId}</span>
            </Heading>
          </Link>
          <Copy text={routeData?.job?.jobId ?? ""} />
        </HStack>
      </VStack>
      <VStack spacing={0} className="flex-shrink justify-center items-end">
        {/* <DetailsTopbar links={links} /> */}
      </VStack>
    </div>
  );
};

export default JobHeader;
