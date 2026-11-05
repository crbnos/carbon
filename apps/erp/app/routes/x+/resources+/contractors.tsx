// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getAbilitiesList } from "~/modules/resources/resources.service";
import { ContractorsTable } from "~/modules/resources/ui";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { contractorsList } from "~/utils/list-registry/resources.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Contractors`,
  to: path.to.contractors
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, contractorsList, {
    dataKey: "contractors",
    bypassRls: true,
    firstPage: async ({ client, companyId }) => ({
      abilities: (await getAbilitiesList(client, companyId)).data ?? []
    }),
    onError: {
      redirectTo: path.to.resources,
      message: "Failed to load contractors"
    }
  });
}

export default function Route() {
  const { contractors, abilities, count, infinite } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ContractorsTable
        data={contractors}
        count={count}
        infinite={infinite}
        // @ts-expect-error TS2322 - TODO: fix type
        abilities={abilities}
      />
      <RecordOutlet />
    </VStack>
  );
}
