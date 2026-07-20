import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { AccessReportTable, getUserAccessReport } from "~/modules/users";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Access Report`,
  to: path.to.accessReport
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "users",
    role: "employee",
    bypassRls: true
  });

  const report = await getUserAccessReport(getCarbonServiceRole(), companyId);

  if (report.error) {
    throw redirect(
      path.to.settings,
      await flash(request, error(report.error, "Error loading access report"))
    );
  }

  return {
    rows: report.data ?? []
  };
}

export default function AccessReportRoute() {
  const { rows } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <AccessReportTable data={rows} count={rows.length} />
      <Outlet />
    </VStack>
  );
}
