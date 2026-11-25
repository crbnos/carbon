// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { respond } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { useRouteDialog } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import { gaugeValidator } from "~/modules/quality/quality.models";
import {
  getGauge,
  getGaugeCalibrationRecordsByGaugeId
} from "~/modules/quality/quality.service";
import type { GaugeType } from "~/modules/quality/types";
import GaugeForm from "~/modules/quality/ui/Gauge/GaugeForm";
import { getCustomFields, setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { getParams, path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Gauges`,
  to: path.to.gauges
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await authorize(request, { "quality.gauges": "View" });

  const serviceRole = await getCarbonServiceRole();

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const gauge = await getGauge(serviceRole, id);

  if (gauge.error) {
    throw redirect(
      path.to.gauges,
      await flash(request, error(gauge.error, "Failed to load gauge"))
    );
  }

  if (gauge.data.companyId !== companyId) {
    throw redirect(path.to.gauges);
  }

  return {
    gauge: gauge.data,
    records: getGaugeCalibrationRecordsByGaugeId(serviceRole, id)
  };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(gaugeValidator).request(args, {
    params: ["id"]
  });
  if ("invalid" in input) return input.invalid;
  const { id } = input.params;
  const d = input.data;
  const { api } = await authorize(args.request);
  const result = await api.quality.updateGauge({
    id,
    gaugeId: d.gaugeId,
    gaugeTypeId: d.gaugeTypeId,
    gaugeRole: d.gaugeRole,
    manufacturer: d.manufacturer || null,
    modelNumber: d.modelNumber || null,
    serialNumber: d.serialNumber || null,
    description: d.description || null,
    dateAcquired: d.dateAcquired || null,
    lastCalibrationDate: d.lastCalibrationDate || null,
    nextCalibrationDate: d.nextCalibrationDate || null,
    locationId: d.locationId || null,
    storageUnitId: d.storageUnitId || null,
    calibrationIntervalInMonths: d.calibrationIntervalInMonths,
    customFields: input.formData ? setCustomFields(input.formData) : undefined
  });
  return respond(args.request, result).redirect(
    `${path.to.gauges}?${getParams(args.request)}`,
    { message: "Updated gauge", onError: path.to.gauge(id) }
  );
}

export default function GaugeRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const { gauge, records } = useLoaderData<typeof loader>();

  const routeData = useRouteData<{
    gaugeTypes: GaugeType[];
  }>(path.to.gauges);

  const initialValues = {
    id: gauge.id,
    gaugeId: gauge.gaugeId,
    manufacturer: gauge.manufacturer ?? "",
    modelNumber: gauge.modelNumber ?? "",
    serialNumber: gauge.serialNumber ?? "",
    description: gauge.description ?? "",
    dateAcquired: gauge.dateAcquired ?? "",
    gaugeTypeId: gauge.gaugeTypeId ?? "",
    gaugeCalibrationStatus: gauge.gaugeCalibrationStatus ?? "Pending",
    gaugeStatus: gauge.gaugeStatus ?? "Active",
    gaugeRole: gauge.gaugeRole ?? "Standard",
    lastCalibrationDate: gauge.lastCalibrationDate ?? "",
    nextCalibrationDate: gauge.nextCalibrationDate ?? "",
    locationId: gauge.locationId ?? "",
    storageUnitId: gauge.storageUnitId ?? "",
    calibrationIntervalInMonths: gauge.calibrationIntervalInMonths ?? 6,
    ...getCustomFields(gauge.customFields)
  };

  const dialog = useRouteDialog();

  return (
    <GaugeForm
      key={id}
      // @ts-expect-error
      initialValues={initialValues}
      records={records}
      gaugeTypes={routeData?.gaugeTypes ?? []}
      open={dialog.open}
      onClose={dialog.close}
    />
  );
}
