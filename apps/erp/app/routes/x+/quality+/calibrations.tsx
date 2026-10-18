// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import GaugeCalibrationRecordsTable from "~/modules/quality/ui/Calibrations/GaugeCalibrationRecordsTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Calibrations`,
  to: path.to.gauges
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
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
      api.quality.getGaugeCalibrationRecords({
        search,
        limit,
        offset,
        sorts,
        filters
      }),
      api.quality.getGaugeTypesList({}),
      api.settings.getCompanySettings({})
    ]);

  return {
    gaugeCalibrationRecords: gaugeCalibrationRecords.data?.rows ?? [],
    count: gaugeCalibrationRecords.data?.count ?? 0,
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
      <RecordOutlet />
    </VStack>
  );
}
