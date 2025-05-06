import { requirePermissions } from "@carbon/auth/auth.server";
import { VStack } from "@carbon/react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import {
  getGaugeCalibrationRecords,
  getGaugeTypesList,
} from "~/modules/quality";
import GaugeCalibrationRecordsTable from "~/modules/quality/ui/Calibrations/GaugeCalibrationRecordsTable";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: "Calibrations",
  to: path.to.gauges,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality",
    role: "employee",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");
  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [gaugeCalibrationRecords, gaugeTypes] = await Promise.all([
    getGaugeCalibrationRecords(client, companyId, {
      search,
      limit,
      offset,
      sorts,
      filters,
    }),
    getGaugeTypesList(client, companyId),
  ]);

  return json({
    gaugeCalibrationRecords: gaugeCalibrationRecords.data ?? [],
    count: gaugeCalibrationRecords.count ?? 0,
    gaugeTypes: gaugeTypes.data ?? [],
  });
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
