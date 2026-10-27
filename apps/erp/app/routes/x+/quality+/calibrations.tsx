// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { RecordOutlet, VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getGaugeTypesList } from "~/modules/quality/quality.service";
import GaugeCalibrationRecordsTable from "~/modules/quality/ui/Calibrations/GaugeCalibrationRecordsTable";
import { getCompanySettings } from "~/modules/settings/settings.service";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { gaugeCalibrationRecordsList } from "~/utils/list-registry/quality.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Calibrations`,
  to: path.to.gauges
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, gaugeCalibrationRecordsList, {
    dataKey: "gaugeCalibrationRecords",
    firstPage: async ({ client, companyId }) => {
      const [gaugeTypes, companySettings] = await Promise.all([
        getGaugeTypesList(client, companyId),
        getCompanySettings(client, companyId)
      ]);
      return {
        gaugeTypes: gaugeTypes.data ?? [],
        useMetric: companySettings.data?.useMetric ?? false
      };
    }
  });
}

export default function GaugesRoute() {
  const { gaugeCalibrationRecords, count, infinite, gaugeTypes } =
    useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <GaugeCalibrationRecordsTable
        data={gaugeCalibrationRecords}
        count={count}
        infinite={infinite}
        types={gaugeTypes}
      />
      <RecordOutlet />
    </VStack>
  );
}
