// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import ProceduresTable from "~/modules/production/ui/Procedures/ProceduresTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Procedures`,
  to: path.to.procedures
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(
    request,
    { "production.procedures": "View" },
    { role: "employee" }
  );

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [procedures, tags] = await Promise.all([
    api.production.getProcedures({
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    api.shared.getTagsList({ table: "procedure" })
  ]);

  return {
    procedures: procedures.data?.rows ?? [],
    tags: tags.data ?? [],
    count: procedures.data?.count ?? 0
  };
}

export default function ProceduresRoute() {
  const { procedures, tags, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ProceduresTable data={procedures} tags={tags} count={count} />
      <RecordOutlet />
    </VStack>
  );
}
