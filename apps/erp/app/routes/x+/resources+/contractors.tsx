// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbonFor } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { ContractorsTable } from "~/modules/resources/ui";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Contractors`,
  to: path.to.contractors
};

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await requirePermissions(request, {
    view: "resources",
    role: "employee",
    bypassRls: true
  });
  const api = carbonFor(auth);

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [contractors, abilities] = await Promise.all([
    api.resources.getContractors({
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    api.resources.getAbilitiesList({})
  ]);

  if (contractors.error) {
    throw redirect(
      path.to.resources,
      await flash(
        request,
        error(contractors.error, "Failed to load contractors")
      )
    );
  }

  return {
    contractors: contractors.data?.rows ?? [],
    abilities: abilities.data ?? [],
    count: contractors.data?.count ?? 0
  };
}

export default function Route() {
  const { contractors, abilities, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ContractorsTable
        data={contractors}
        count={count}
        // @ts-expect-error TS2322 - TODO: fix type
        abilities={abilities}
      />
      <RecordOutlet />
    </VStack>
  );
}
