import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Button, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { LuCalendarPlus } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData, useNavigate } from "react-router";
import { usePermissions } from "~/hooks";
import { getAccountingPeriods } from "~/modules/accounting";
import { PeriodsTable } from "~/modules/accounting/ui/Periods";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Accounting Periods`,
  to: path.to.accountingPeriods
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const periods = await getAccountingPeriods(client, companyId);
  if (periods.error) {
    throw redirect(
      path.to.accounting,
      await flash(
        request,
        error(periods.error, "Failed to load accounting periods")
      )
    );
  }

  return { periods: periods.data ?? [], count: periods.count ?? 0 };
}

export default function AccountingPeriodsRoute() {
  const { periods, count } = useLoaderData<typeof loader>();
  const permissions = usePermissions();
  const navigate = useNavigate();

  return (
    <VStack spacing={0} className="h-full">
      <PeriodsTable
        data={periods}
        count={count}
        primaryAction={
          permissions.can("create", "accounting") ? (
            <Button
              leftIcon={<LuCalendarPlus />}
              variant="primary"
              onClick={() => navigate(path.to.accountingPeriodsGenerate)}
            >
              <Trans>Generate Fiscal Year</Trans>
            </Button>
          ) : undefined
        }
      />
      <Outlet />
    </VStack>
  );
}
