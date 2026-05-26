import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import {
  getGaugeCalibrationRecords,
  getGaugeTypesList
} from "~/modules/quality/quality.service.server";
import GaugeCalibrationRecordsTable from "~/modules/quality/ui/Calibrations/GaugeCalibrationRecordsTable";
import { getCompanySettings } from "~/modules/settings/settings.service.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Calibrations`,
  to: path.to.gauges
};

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "quality",
    role: "employee"
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [gaugeCalibrationRecords, gaugeTypes, companySettings] =
    await Promise.all([
      getGaugeCalibrationRecords({
        search,
        limit,
        offset,
        sorts,
        filters
      }),
      getGaugeTypesList(),
      getCompanySettings()
    ]);

  return {
    gaugeCalibrationRecords: gaugeCalibrationRecords.data ?? [],
    count: gaugeCalibrationRecords.count ?? 0,
    gaugeTypes: gaugeTypes.data ?? [],
    useMetric: companySettings.data?.useMetric ?? false
  };
}

export default function GaugesRoute() {
  const { gaugeCalibrationRecords, count, gaugeTypes } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <GaugeCalibrationRecordsTable
        data={gaugeCalibrationRecords}
        count={count}
        types={gaugeTypes}
      />
      <Outlet />
    </VStack>
  );
}
