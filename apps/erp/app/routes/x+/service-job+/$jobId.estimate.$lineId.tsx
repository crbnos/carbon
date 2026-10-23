// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { isServiceJobLocked } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { Navigate, useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { serviceJobEstimateLineValidator } from "~/modules/service/service.models";
import type {
  ServiceJobDetail,
  ServiceJobEstimateLine
} from "~/modules/service/types";
import ServiceJobEstimateLineForm from "~/modules/service/ui/ServiceJob/ServiceJobEstimateLineForm";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(serviceJobEstimateLineValidator).request(args, {
    params: ["jobId", "lineId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.service.upsertServiceJobEstimateLine({
    ...input.data,
    id: input.params.lineId,
    serviceJobId: input.params.jobId
  });
}

export default function ServiceJobEstimateLineRoute() {
  const { jobId, lineId } = useParams();
  if (!jobId || !lineId) throw new Error("Could not find jobId or lineId");
  const navigate = useNavigate();
  const routeData = useRouteData<{
    job: ServiceJobDetail;
    estimateLines: ServiceJobEstimateLine[];
  }>(path.to.serviceJob(jobId));
  const job = routeData?.job;

  const line = routeData?.estimateLines.find((row) => row.id === lineId);
  if (!line) return <Navigate to={path.to.serviceJob(jobId)} replace />;

  return (
    <ServiceJobEstimateLineForm
      key={line.id}
      initialValues={{
        id: line.id,
        serviceJobId: jobId,
        itemId: line.itemId,
        description: line.description ?? "",
        quantity: line.quantity,
        unitPrice: line.unitPrice
      }}
      isLocked={
        isServiceJobLocked(job?.status) ||
        job?.estimateStatus === "Sent" ||
        job?.estimateStatus === "Accepted"
      }
      onClose={() => navigate(path.to.serviceJob(jobId))}
    />
  );
}
