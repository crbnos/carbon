// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getPayrollPeriodTotals } from "~/modules/people/people.service";
import PayrollTotalsTable from "~/modules/people/ui/PayrollTotals/PayrollTotalsTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

const logger = getLogger("erp", "payroll-totals");

export const handle: Handle = {
  breadcrumb: msg`Payroll Totals`,
  to: path.to.payrollTotals
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "people"
  });

  const searchParams = new URL(request.url).searchParams;
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const totals = await getPayrollPeriodTotals(client, companyId, {
    limit,
    offset,
    sorts,
    filters
  });
  if (totals.error) {
    logger.error("Failed to load the payroll totals", {
      companyId,
      error: totals.error
    });
    throw redirect(
      path.to.people,
      await flash(request, error(totals.error, "Failed to load payroll totals"))
    );
  }

  return { totals: totals.data ?? [], count: totals.count ?? 0 };
}

export default function PayrollTotalsRoute() {
  const { totals, count } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <PayrollTotalsTable data={totals} count={count} />
    </VStack>
  );
}
