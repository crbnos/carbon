import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLocalTimeZone, parseDate, today } from "@internationalized/date";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { GaugeType } from "~/modules/quality";
import {
  gaugeValidator,
  getGauge,
  getGaugeCalibrationRecordsByGaugeId,
  updateGauge
} from "~/modules/quality";
import GaugeForm from "~/modules/quality/ui/Gauge/GaugeForm";
import { getCustomFields, setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { getParams, path } from "~/utils/path";
export const handle: Handle = {
  breadcrumb: msg`Gauges`,
  to: path.to.gauges
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "quality"
  });

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

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "quality"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(gaugeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { gaugeId, ...d } = validation.data;
  if (!gaugeId) throw new Error("Could not find gaugeId");

  const gaugeCalibrationStatus = d.nextCalibrationDate
    ? parseDate(d.nextCalibrationDate) < today(getLocalTimeZone())
      ? "Out-of-Calibration"
      : d.lastCalibrationDate
        ? "In-Calibration"
        : "Pending"
    : "Pending";

  const update = await updateGauge(client, {
    id,
    gaugeId,
    gaugeCalibrationStatus,
    gaugeTypeId: d.gaugeTypeId,
    gaugeRole: d.gaugeRole,
    supplierId: d.supplierId || null,
    modelNumber: d.modelNumber || null,
    serialNumber: d.serialNumber || null,
    description: d.description || null,
    dateAcquired: d.dateAcquired || null,
    lastCalibrationDate: d.lastCalibrationDate || null,
    nextCalibrationDate: d.nextCalibrationDate || null,
    locationId: d.locationId || null,
    storageUnitId: d.storageUnitId || null,
    calibrationIntervalInMonths: d.calibrationIntervalInMonths,
    customFields: setCustomFields(formData),
    updatedBy: userId
  });
  if (update.error) {
    throw redirect(
      path.to.gauge(id),
      await flash(request, error(update.error, "Failed to update gauge"))
    );
  }

  throw redirect(
    `${path.to.gauges}?${getParams(request)}`,
    await flash(request, success("Updated gauge"))
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
    supplierId: gauge.supplierId ?? "",
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

  const navigate = useNavigate();

  return (
    <GaugeForm
      key={id}
      // @ts-ignore
      initialValues={initialValues}
      records={records}
      gaugeTypes={routeData?.gaugeTypes ?? []}
      onClose={() => navigate(-1)}
    />
  );
}
