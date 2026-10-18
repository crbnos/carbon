// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { ServicesTable } from "~/modules/items/ui/Services";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  realtime: ["item"],
  breadcrumb: msg`Services`,
  to: path.to.services
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "parts",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const supplierId = searchParams.get("supplierId");
  const group = searchParams.get("group");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [services, tags] = await Promise.all([
    api.items.getServices({
      search,
      supplierId,
      group,
      limit,
      offset,
      sorts,
      filters
    }),
    api.shared.getTagsList({ table: "service" })
  ]);

  if (services.error) {
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(services.error, "Failed to fetch services"))
    );
  }

  return {
    count: services.data?.count ?? 0,
    services: services.data?.rows ?? [],
    tags: tags.data ?? []
  };
}

export default function ServicesSearchRoute() {
  const { count, services, tags } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ServicesTable data={services} count={count} tags={tags} />
      <RecordOutlet />
    </VStack>
  );
}
