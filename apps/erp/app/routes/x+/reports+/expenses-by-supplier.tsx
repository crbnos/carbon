import { requirePermissions } from "@carbon/auth/auth.server";
import { datetime, defaultReportRange } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getFiscalYearSettings } from "~/modules/accounting";
import { getExpensesBySupplier } from "~/modules/invoicing";
import { SpendByPartyReport } from "~/modules/invoicing/ui/Reports";
import { months } from "~/modules/shared";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Expenses by Supplier`,
  to: path.to.expensesBySupplier
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting",
    role: "employee"
  });

  const url = new URL(request.url);
  // Default range: the trailing six months (shared with every other range
  // report via defaultReportRange), in the company's business timezone.
  const range = defaultReportRange(
    url.searchParams.get("endDate") ??
      datetime.today(await getCompanyTimeZone(client, companyId)).toString()
  );
  const startDate = url.searchParams.get("startDate") ?? range.startDate;
  const endDate = range.endDate;

  const [expenses, fiscalYearSettings] = await Promise.all([
    getExpensesBySupplier(client, companyId, { startDate, endDate }),
    getFiscalYearSettings(client, companyId)
  ]);

  const fiscalStartMonth =
    months.indexOf(fiscalYearSettings.data?.startMonth ?? "January") + 1;

  return {
    rows: expenses.data,
    fiscalStartMonth
  };
}

export default function ExpensesBySupplierRoute() {
  const { rows, fiscalStartMonth } = useLoaderData<typeof loader>();
  return (
    <SpendByPartyReport
      kind="supplier"
      data={rows}
      fiscalStartMonth={fiscalStartMonth}
    />
  );
}
