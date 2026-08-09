import { requirePermissions } from "@carbon/auth/auth.server";
import { datetime, defaultReportRange } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getFiscalYearSettings } from "~/modules/accounting";
import { getRevenueByCustomer } from "~/modules/invoicing";
import { SpendByPartyReport } from "~/modules/invoicing/ui/Reports";
import { months } from "~/modules/shared";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Revenue by Customer`,
  to: path.to.revenueByCustomer
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

  const [revenue, fiscalYearSettings] = await Promise.all([
    getRevenueByCustomer(client, companyId, { startDate, endDate }),
    getFiscalYearSettings(client, companyId)
  ]);

  const fiscalStartMonth =
    months.indexOf(fiscalYearSettings.data?.startMonth ?? "January") + 1;

  return {
    rows: revenue.data,
    fiscalStartMonth
  };
}

export default function RevenueByCustomerRoute() {
  const { rows, fiscalStartMonth } = useLoaderData<typeof loader>();
  return (
    <SpendByPartyReport
      kind="customer"
      data={rows}
      fiscalStartMonth={fiscalStartMonth}
    />
  );
}
