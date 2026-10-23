// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { isServiceJobLocked } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { useCompanyToday, useRouteData, useUser } from "~/hooks";
import { serviceJobTimeValidator } from "~/modules/service/service.models";
import type { ServiceJobDetail } from "~/modules/service/types";
import ServiceJobTimeForm from "~/modules/service/ui/ServiceJob/ServiceJobTimeForm";
import { getCompanySettings } from "~/modules/settings/settings.service";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "service"
  });
  const settings = await getCompanySettings(client, companyId);
  return { laborItemId: settings.data?.serviceLaborItemId ?? "" };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(serviceJobTimeValidator).request(args, {
    params: ["jobId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.service.upsertServiceJobTime({
    ...input.data,
    id: undefined,
    serviceJobId: input.params.jobId
  });
}

export default function NewServiceJobTimeRoute() {
  const { jobId } = useParams();
  if (!jobId) throw new Error("Could not find jobId");
  const navigate = useNavigate();
  const { laborItemId } = useLoaderData<typeof loader>();
  const user = useUser();
  const today = useCompanyToday();
  const routeData = useRouteData<{ job: ServiceJobDetail }>(
    path.to.serviceJob(jobId)
  );

  return (
    <ServiceJobTimeForm
      initialValues={{
        serviceJobId: jobId,
        employeeId: user.id,
        laborItemId,
        entryDate: today,
        hours: 1,
        billable: routeData?.job?.coverage === "Billable",
        note: ""
      }}
      isLocked={isServiceJobLocked(routeData?.job?.status)}
      onClose={() => navigate(path.to.serviceJob(jobId))}
    />
  );
}
