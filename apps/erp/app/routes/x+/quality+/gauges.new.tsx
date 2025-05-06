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
import { useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { useRouteData, useUser } from "~/hooks";
import type { GaugeType } from "~/modules/quality";
import { gaugeValidator, upsertGauge } from "~/modules/quality";
import GaugeForm from "~/modules/quality/ui/Gauge/GaugeForm";

import { getNextSequence } from "~/modules/settings";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "quality",
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "quality",
  });

  const formData = await request.formData();
  const validation = await validator(gaugeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  let gaugeId = validation.data.gaugeId;
  const useNextSequence = !gaugeId;
  if (useNextSequence) {
    const nextSequence = await getNextSequence(
      getCarbonServiceRole(),
      "gauge",
      companyId
    );
    if (nextSequence.error) {
      throw redirect(
        path.to.newGauge,
        await flash(
          request,
          error(nextSequence.error, "Failed to get next sequence")
        )
      );
    }
    gaugeId = nextSequence.data;
  }

  if (!gaugeId) throw new Error("gaugeId is not defined");
  const { id: _id, ...data } = validation.data;

  const gaugeCalibrationStatus = data.nextCalibrationDate
    ? parseDate(data.nextCalibrationDate) < today(getLocalTimeZone())
      ? "Out-of-Calibration"
      : data.lastCalibrationDate
      ? "In-Calibration"
      : "Pending"
    : "Pending";

  const createGauge = await upsertGauge(client, {
    ...data,
    gaugeId,
    gaugeCalibrationStatus,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  if (createGauge.error || !createGauge.data) {
    throw redirect(
      path.to.gauges,
      await flash(request, error(createGauge.error, "Failed to insert gauge"))
    );
  }

  const readableId = createGauge.data?.gaugeId;
  if (!readableId) {
    throw redirect(
      path.to.gauges,
      await flash(request, error("Failed to insert gauge"))
    );
  }

  throw redirect(
    `${path.to.gauges}?${getParams(request)}`,
    await flash(request, success(`Gauge ${readableId} created`))
  );
}

export default function GaugeNewRoute() {
  const { defaults } = useUser();
  const navigate = useNavigate();

  const routeData = useRouteData<{
    gaugeTypes: GaugeType[];
  }>(path.to.gauges);

  const initialValues = {
    id: undefined,
    gaugeId: undefined,
    supplierId: "",
    modelNumber: "",
    serialNumber: "",
    description: "",
    dateAcquired: today(getLocalTimeZone()).toString(),
    gaugeTypeId: "",
    gaugeCalibrationStatus: "Pending" as const,
    gaugeStatus: "Active" as const,
    gaugeRole: "Standard" as const,
    lastCalibrationDate: "",
    nextCalibrationDate: "",
    locationId: defaults.locationId ?? "",
    shelfId: "",
    calibrationIntervalInMonths: 6,
  };

  return (
    <GaugeForm
      initialValues={initialValues}
      gaugeTypes={routeData?.gaugeTypes ?? []}
      onClose={() => navigate(-1)}
    />
  );
}
