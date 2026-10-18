// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbonFor } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import IssuesTable from "~/modules/quality/ui/Issue/IssuesTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "issues");

export const handle: Handle = {
  realtime: ["nonConformance"],
  breadcrumb: msg`Issues`,
  to: path.to.issues
};

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = await requirePermissions(request, {
    view: "quality",
    role: "employee"
  });
  const api = carbonFor(auth);

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [issues, nonConformanceTypes] = await Promise.all([
    api.quality.getIssues({
      search,
      limit,
      offset,
      sorts,
      filters
    }),
    api.quality.getIssueTypesList({})
  ]);

  if (issues.error) {
    logger.error(issues.error);
    throw redirect(
      path.to.authenticatedRoot,
      await flash(request, error(issues.error, "Error loading issues"))
    );
  }

  return {
    issues: issues.data?.rows ?? [],
    count: issues.data?.count ?? 0,
    types: nonConformanceTypes.data ?? []
  };
}

export default function IssuesRoute() {
  const { issues, count, types } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <IssuesTable data={issues} count={count} types={types} />
      <RecordOutlet />
    </VStack>
  );
}
