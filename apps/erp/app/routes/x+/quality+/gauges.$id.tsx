import {
  assertIsPost,
  error,
  getCarbonServiceRole,
  success,
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLocalTimeZone, parseDate, today } from "@internationalized/date";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { defer, redirect } from "@vercel/remix";
import { useRouteData } from "~/hooks";
import type { GaugeType } from "~/modules/quality";
import {
  gaugeValidator,
  getGauge,
  getGaugeCalibrationRecordsByGaugeId,
  upsertGauge,
} from "~/modules/quality";
import GaugeForm from "~/modules/quality/ui/Gauge/GaugeForm";
import { getCustomFields, setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { getParams, path } from "~/utils/path";
export const handle: Handle = {
  breadcrumb: "Gauges",
  to: path.to.gauges,
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId } = await requirePermissions(request, {
    view: "quality",
  });

  const serviceRole = await getCarbonServiceRole();

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [gauge] = await Promise.all([getGauge(serviceRole, id)]);

  if (gauge.error) {
    throw redirect(
      path.to.gauges,
      await flash(request, error(gauge.error, "Failed to load gauge"))
    );
  }

  if (gauge.data.companyId !== companyId) {
    throw redirect(path.to.gauges);
  }

  return defer({
    gauge: gauge.data,
    records: getGaugeCalibrationRecordsByGaugeId(serviceRole, id),
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "quality",
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const formData = await request.formData();
  const validation = await validator(gaugeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { gaugeId, ...data } = validation.data;
  if (!gaugeId) throw new Error("Could not find gaugeId");

  const gaugeCalibrationStatus = data.nextCalibrationDate
    ? parseDate(data.nextCalibrationDate) < today(getLocalTimeZone())
      ? "Out-of-Calibration"
      : data.lastCalibrationDate
      ? "In-Calibration"
      : "Pending"
    : "Pending";

  const update = await upsertGauge(client, {
    id,
    gaugeId,
    gaugeCalibrationStatus,
    ...data,
    customFields: setCustomFields(formData),
    updatedBy: userId,
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
    shelfId: gauge.shelfId ?? "",
    calibrationIntervalInMonths: gauge.calibrationIntervalInMonths ?? 6,
    ...getCustomFields(gauge.customFields),
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
