import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLocalTimeZone, today } from "@internationalized/date";
import { useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import {
  gaugeCalibrationRecordValidator,
  upsertGaugeCalibrationRecord,
} from "~/modules/quality";
import GaugeCalibrationRecordForm from "~/modules/quality/ui/Calibrations/GaugeCalibrationRecordForm";

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
  const validation = await validator(gaugeCalibrationRecordValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, ...data } = validation.data;

  const inspectionStatus =
    data.requiresAction || data.requiresAdjustment || data.requiresRepair
      ? "Fail"
      : "Pass";

  const createGauge = await upsertGaugeCalibrationRecord(client, {
    ...data,
    inspectionStatus,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });

  if (createGauge.error || !createGauge.data) {
    throw redirect(
      path.to.gauges,
      await flash(
        request,
        error(createGauge.error, "Failed to insert gauge calibration record")
      )
    );
  }

  throw redirect(
    `${path.to.calibrations}?${getParams(request)}`,
    await flash(request, success("Calibration record created"))
  );
}

export default function GaugeCalibrationRecordNewRoute() {
  const navigate = useNavigate();

  const initialValues = {
    id: undefined,
    gaugeId: "",
    dateCalibrated: today(getLocalTimeZone()).toString(),
    requiresAction: false,
    requiresAdjustment: false,
    requiresRepair: false,
    notes: "{}",
    dateAcquired: today(getLocalTimeZone()).toString(),
  };

  return (
    <GaugeCalibrationRecordForm
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
