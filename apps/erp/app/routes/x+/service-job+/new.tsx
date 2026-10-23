// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { NewRecordPage } from "~/components/NewRecordPage";
import { serviceJobValidator } from "~/modules/service/service.models";
import { getCustomerAssetsList } from "~/modules/service/service.service";
import ServiceJobForm from "~/modules/service/ui/ServiceJob/ServiceJobForm";
import { getUserDefaults } from "~/modules/users/users.service";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Jobs`,
  to: path.to.serviceJobs,
  module: "service"
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "service"
  });

  const searchParams = new URL(request.url).searchParams;

  const [assets, defaults] = await Promise.all([
    getCustomerAssetsList(client, companyId),
    getUserDefaults(client, userId, companyId)
  ]);

  return {
    assets: assets.data ?? [],
    defaultLocationId: defaults.data?.locationId ?? undefined,
    customerId: searchParams.get("customerId") ?? undefined,
    customerAssetId: searchParams.get("customerAssetId") ?? undefined
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(serviceJobValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.service.createServiceJob(input.data);
  return respond(args.request, result).redirect(
    result.data ? path.to.serviceJob(result.data.id) : path.to.serviceJobs,
    { message: "Created service job" }
  );
}

export default function NewServiceJobRoute() {
  const { assets, defaultLocationId, customerId, customerAssetId } =
    useLoaderData<typeof loader>();

  const initialValues = {
    customerId: customerId ?? "",
    customerAssetId,
    locationId: defaultLocationId ?? "",
    workSite: "Depot" as const,
    billingMethod: "Time and Materials" as const,
    priority: "Medium" as const
  };

  return (
    <NewRecordPage>
      <ServiceJobForm initialValues={initialValues} assets={assets} />
    </NewRecordPage>
  );
}
