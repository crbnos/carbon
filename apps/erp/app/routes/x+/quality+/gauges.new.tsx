// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { useRouteDialog } from "@carbon/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useCompanyToday, useRouteData, useUser } from "~/hooks";
import { gaugeValidator } from "~/modules/quality/quality.models";
import type { GaugeType } from "~/modules/quality/types";
import GaugeForm from "~/modules/quality/ui/Gauge/GaugeForm";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "quality"
  });

  return null;
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(gaugeValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { id: _id, ...gauge } = input.data;
  const api = await carbon(args.request);
  const result = await api.quality.insertGauge({
    ...gauge,
    gaugeId: gauge.gaugeId || undefined,
    customFields: input.formData ? setCustomFields(input.formData) : undefined
  });
  if (result.error || !result.data) {
    return respond(args.request, result).redirect(path.to.gauges, {
      onError: path.to.gauges
    });
  }
  return respond(args.request, result).redirect(
    `${path.to.gauges}?${getParams(args.request)}`,
    { message: `Gauge ${result.data.gaugeId} created` }
  );
}

export default function GaugeNewRoute() {
  const { defaults } = useUser();
  const dialog = useRouteDialog();

  const routeData = useRouteData<{
    gaugeTypes: GaugeType[];
  }>(path.to.gauges);

  const companyToday = useCompanyToday();
  const initialValues = {
    id: undefined,
    gaugeId: undefined,
    manufacturer: "",
    modelNumber: "",
    serialNumber: "",
    description: "",
    dateAcquired: companyToday,
    gaugeTypeId: "",
    gaugeCalibrationStatus: "Pending" as const,
    gaugeStatus: "Active" as const,
    gaugeRole: "Standard" as const,
    lastCalibrationDate: "",
    nextCalibrationDate: "",
    locationId: defaults.locationId ?? "",
    storageUnitId: "",
    calibrationIntervalInMonths: 6
  };

  return (
    <GaugeForm
      initialValues={initialValues}
      gaugeTypes={routeData?.gaugeTypes ?? []}
      open={dialog.open}
      onClose={dialog.close}
    />
  );
}
