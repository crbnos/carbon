// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { isUnaffectedByNavigation, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { data, Outlet, useLoaderData } from "react-router";
import { getRisks } from "~/modules/quality/quality.service";
import type { Risk } from "~/modules/quality/types";
import RiskRegistersTable from "~/modules/quality/ui/RiskRegister/RiskRegistersTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Risks`,
  to: path.to.risks
};

export const shouldRevalidate: ShouldRevalidateFunction = (args) =>
  isUnaffectedByNavigation(args, { search: "all" })
    ? false
    : args.defaultShouldRevalidate;

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const risks = await getRisks(client, companyId, {
    search,
    limit,
    offset,
    sorts,
    filters
  });

  if (risks.error) {
    redirect(
      path.to.quality,
      await flash(request, error(risks.error, "Failed to fetch risks"))
    );
  }

  return data({
    count: risks.count ?? 0,
    risks: (risks.data ?? []) as unknown as Risk[]
  });
}

export default function RisksRoute() {
  const { count, risks } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <RiskRegistersTable data={risks} count={count} />
      <Outlet />
    </VStack>
  );
}
