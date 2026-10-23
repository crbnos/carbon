// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getServiceTemplates } from "~/modules/service/service.service";
import ServiceTemplatesTable from "~/modules/service/ui/Templates/ServiceTemplatesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Service Templates`,
  to: path.to.serviceTemplates
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "service"
  });

  const searchParams = new URL(request.url).searchParams;
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const templates = await getServiceTemplates(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters
  });
  if (templates.error) {
    throw redirect(
      path.to.serviceOrders,
      await flash(
        request,
        error(templates.error, "Failed to load the service templates")
      )
    );
  }

  return {
    templates: templates.data ?? [],
    count: templates.count ?? 0
  };
}

export default function ServiceTemplatesRoute() {
  const { templates, count } = useLoaderData<typeof loader>();
  return (
    <VStack spacing={0} className="h-full">
      <ServiceTemplatesTable data={templates} count={count} />
      <RecordOutlet />
    </VStack>
  );
}
