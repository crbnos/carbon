// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { isServiceJobLocked } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { Navigate, useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { serviceJobTimeValidator } from "~/modules/service/service.models";
import type { ServiceJobDetail, ServiceJobTime } from "~/modules/service/types";
import ServiceJobTimeForm from "~/modules/service/ui/ServiceJob/ServiceJobTimeForm";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(serviceJobTimeValidator).request(args, {
    params: ["jobId", "timeId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.service.upsertServiceJobTime({
    ...input.data,
    id: input.params.timeId,
    serviceJobId: input.params.jobId
  });
}

export default function ServiceJobTimeRoute() {
  const { jobId, timeId } = useParams();
  if (!jobId || !timeId) throw new Error("Could not find jobId or timeId");
  const navigate = useNavigate();
  const routeData = useRouteData<{
    job: ServiceJobDetail;
    time: ServiceJobTime[];
  }>(path.to.serviceJob(jobId));

  const entry = routeData?.time.find((row) => row.id === timeId);
  // Deleted, or not this job's: back to the job.
  if (!entry) return <Navigate to={path.to.serviceJob(jobId)} replace />;

  return (
    <ServiceJobTimeForm
      key={entry.id}
      initialValues={{
        id: entry.id,
        serviceJobId: jobId,
        employeeId: entry.employeeId,
        laborItemId: entry.laborItemId,
        entryDate: entry.entryDate,
        hours: entry.hours,
        billable: entry.billable,
        note: entry.note ?? ""
      }}
      isLocked={isServiceJobLocked(routeData?.job?.status)}
      onClose={() => navigate(path.to.serviceJob(jobId))}
    />
  );
}
