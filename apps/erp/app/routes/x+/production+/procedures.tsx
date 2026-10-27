// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import ProceduresTable from "~/modules/production/ui/Procedures/ProceduresTable";
import { getTagsList } from "~/modules/shared/shared.service";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { proceduresList } from "~/utils/list-registry/production.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Procedures`,
  to: path.to.procedures
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, proceduresList, {
    dataKey: "procedures",
    firstPage: async ({ client, companyId }) => ({
      tags: (await getTagsList(client, companyId, "procedure")).data ?? []
    })
  });
}

export default function ProceduresRoute() {
  const { procedures, tags, count, infinite } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ProceduresTable
        data={procedures}
        tags={tags}
        count={count}
        infinite={infinite}
      />
      <RecordOutlet />
    </VStack>
  );
}
