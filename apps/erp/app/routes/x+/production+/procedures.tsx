// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { isUnaffectedByNavigation } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { getProcedures } from "~/modules/production";
import ProceduresTable from "~/modules/production/ui/Procedures/ProceduresTable";
import { getTagsList } from "~/modules/shared";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Procedures`,
  to: path.to.procedures
};

export const shouldRevalidate: ShouldRevalidateFunction = (args) =>
  isUnaffectedByNavigation(args, { search: "all" })
    ? false
    : args.defaultShouldRevalidate;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [procedures, tags] = await Promise.all([
    getProcedures(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    getTagsList(client, companyId, "procedure")
  ]);

  return {
    procedures: procedures.data ?? [],
    tags: tags.data ?? [],
    count: procedures.count ?? 0
  };
}

export default function ProceduresRoute() {
  const { procedures, tags, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <ProceduresTable data={procedures} tags={tags} count={count} />
      <Outlet />
    </VStack>
  );
}
