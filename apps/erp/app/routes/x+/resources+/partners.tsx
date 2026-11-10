// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { PartnersTable } from "~/modules/resources/ui";
import type { Handle } from "~/utils/handle";
import { SINGLE_LOAD_LIMIT } from "~/utils/pagination";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Partners`,
  to: path.to.partners
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(
    request,
    { "resources.abilities": "View" },
    { role: "employee", bypassRls: true }
  );

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { sorts, filters } = getGenericQueryFilters(searchParams);

  // A partner has one row per ability, so `id` is not unique and a cursor
  // cannot page the list. It loads once: the first SINGLE_LOAD_LIMIT rows.
  const [partners] = await Promise.all([
    api.resources.getPartners({
      search,
      limit: SINGLE_LOAD_LIMIT,
      offset: 0,
      sorts,
      filters
    }),
    api.resources.getAbilitiesList({})
  ]);

  if (partners.error) {
    throw redirect(
      path.to.resources,
      await flash(request, error(partners.error, "Failed to load partners"))
    );
  }

  return {
    partners: partners.data?.rows ?? [],
    count: partners.data?.count ?? 0,
    isTruncated: (partners.data?.rows?.length ?? 0) >= SINGLE_LOAD_LIMIT
  };
}

export default function Route() {
  const { partners, count, isTruncated } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <PartnersTable data={partners} count={count} isTruncated={isTruncated} />
      <RecordOutlet />
    </VStack>
  );
}
