// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { isServiceJobLocked } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { serviceJobItemValidator } from "~/modules/service/service.models";
import type { ServiceJobDetail } from "~/modules/service/types";
import ServiceJobChargeForm from "~/modules/service/ui/ServiceJob/ServiceJobChargeForm";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(serviceJobItemValidator).request(args, {
    params: ["jobId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.service.upsertServiceJobCharge({
    ...input.data,
    id: undefined,
    serviceJobId: input.params.jobId
  });
}

export default function NewServiceJobChargeRoute() {
  const { jobId } = useParams();
  if (!jobId) throw new Error("Could not find jobId");
  const navigate = useNavigate();
  const routeData = useRouteData<{ job: ServiceJobDetail }>(
    path.to.serviceJob(jobId)
  );

  return (
    <ServiceJobChargeForm
      initialValues={{
        serviceJobId: jobId,
        itemId: "",
        description: "",
        quantity: 1,
        unitPrice: 0,
        billable: routeData?.job?.coverage === "Billable"
      }}
      isLocked={isServiceJobLocked(routeData?.job?.status)}
      onClose={() => navigate(path.to.serviceJob(jobId))}
    />
  );
}
