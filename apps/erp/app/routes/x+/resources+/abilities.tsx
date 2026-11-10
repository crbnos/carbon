// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { AbilitiesTable } from "~/modules/resources/ui";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { abilitiesList } from "~/utils/list-registry/resources.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Abilities`,
  to: path.to.abilities
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, abilitiesList, {
    dataKey: "abilities",
    onError: {
      redirectTo: path.to.resources,
      message: "Failed to fetch abilities"
    }
  });
}

export default function AbilitiesRoute() {
  const { count, abilities, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <AbilitiesTable data={abilities} count={count} infinite={infinite} />
      <RecordOutlet />
    </VStack>
  );
}
