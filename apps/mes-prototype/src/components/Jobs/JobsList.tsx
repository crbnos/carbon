import { ScrollArea } from "@carbon/react";
import { useParams } from "react-router-dom";
import type { Job, JobSettings } from "~/types";
import { JobCard } from "./JobCard";

type JobsListProps = JobSettings & {
  jobs: Job[];
};

export function JobsList({ jobs, ...settings }: JobsListProps) {
  const { operationId } = useParams();

  return (
    <ScrollArea className="h-[calc(100vh-120px)]">
      <div className="flex flex-col gap-2 p-4 pt-0">
        {jobs.map((job) => (
          <JobCard
            key={job.id}
            job={job}
            isSelected={operationId == job.id}
            {...settings}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
