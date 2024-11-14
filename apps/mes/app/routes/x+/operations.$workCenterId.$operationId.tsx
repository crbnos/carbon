import { useLoaderData, useParams } from "@remix-run/react";

import { JobOperation } from "~/components";

import type { loader } from "~/services/operation.server";
import { path } from "~/utils/path";
export { loader } from "~/services/operation.server";

export default function OperationRoute() {
  const { operationId, workCenterId } = useParams();
  if (!operationId) throw new Error("Operation ID is required");
  if (!workCenterId) throw new Error("Work Center ID is required");

  const { events, job, files, materials, operation, thumbnailPath } =
    useLoaderData<typeof loader>();

  return (
    <JobOperation
      backPath={path.to.workCenter(workCenterId)}
      events={events}
      files={files}
      materials={materials}
      operation={operation}
      job={job}
      thumbnailPath={thumbnailPath}
    />
  );
}
