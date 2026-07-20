import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { getSodConflicts, SodReportTable } from "~/modules/settings";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`SoD Report`,
  to: path.to.sodReport
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "settings",
    role: "employee",
    bypassRls: true
  });

  const report = await getSodConflicts(getCarbonServiceRole(), companyId);

  if (report.error) {
    throw redirect(
      path.to.settings,
      await flash(request, error(report.error, "Error loading SoD report"))
    );
  }

  return {
    rows: report.data ?? []
  };
}

export default function SodReportRoute() {
  const { rows } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <SodReportTable data={rows} count={rows.length} />
      <Outlet />
    </VStack>
  );
}
