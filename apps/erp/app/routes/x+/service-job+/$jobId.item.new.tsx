// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import { isServiceJobLocked } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { serviceJobItemValidator } from "~/modules/service/service.models";
import type { ServiceJobDetail } from "~/modules/service/types";
import ServiceJobChargeForm from "~/modules/service/ui/ServiceJob/ServiceJobChargeForm";
import { path } from "~/utils/path";

/** The posted lines the charge's cost can be linked to. */
export async function loader(args: LoaderFunctionArgs) {
  const { jobId } = args.params;
  if (!jobId) throw new Error("Could not find jobId");
  const api = await carbon(args.request);
  const result = await api.service.getLinkableCostLines({
    serviceJobId: jobId
  });
  return result.data ?? { lines: [], coverageAccount: null };
}

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
  const { lines, coverageAccount } = useLoaderData<typeof loader>();
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
      costLines={lines}
      coverageAccount={coverageAccount}
      isLocked={isServiceJobLocked(routeData?.job?.status)}
      onClose={() => navigate(path.to.serviceJob(jobId))}
    />
  );
}
