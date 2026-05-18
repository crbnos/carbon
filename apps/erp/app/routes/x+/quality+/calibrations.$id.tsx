import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import type z from "zod";
import type { calibrationAttempt } from "~/modules/quality";
import {
  gaugeCalibrationRecordValidator,
  getGaugeCalibrationRecord,
  getQualityFiles,
  upsertGaugeCalibrationRecord
} from "~/modules/quality";
import GaugeCalibrationRecordForm from "~/modules/quality/ui/Calibrations/GaugeCalibrationRecordForm";
import { getCustomFields, setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { getParams, path } from "~/utils/path";
export const handle: Handle = {
  breadcrumb: msg`Gauges`,
  to: path.to.gauges
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "quality",
    bypassRls: true
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [record, files] = await Promise.all([
    getGaugeCalibrationRecord(id),
    getQualityFiles(id)
  ]);

  if (record.error) {
    throw redirect(
      path.to.gauges,
      await flash(
        request,
        error(record.error, "Failed to load gauge calibration record")
      )
    );
  }

  return {
    record: record.data,
    files: files ?? []
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "quality"
  });

  const formData = await request.formData();
  const validation = await validator(gaugeCalibrationRecordValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("Could not find id");

  const inspectionStatus =
    d.requiresAction || d.requiresAdjustment || d.requiresRepair
      ? "Fail"
      : "Pass";

  const updateGauge = await upsertGaugeCalibrationRecord({
    id,
    ...d,
    inspectionStatus,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateGauge.error) {
    throw redirect(
      `${path.to.calibrations}?${getParams(request)}`,
      await flash(
        request,
        error(updateGauge.error, "Failed to update gauge calibration record")
      )
    );
  }

  throw redirect(
    `${path.to.calibrations}?${getParams(request)}`,
    await flash(request, success("Calibration record created"))
  );
}

export default function GaugeCalibrationRecordRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const { record, files } = useLoaderData<typeof loader>();

  const initialValues = {
    id: record.id!,
    gaugeId: record.gaugeId || "",
    dateCalibrated: record.dateCalibrated || "",
    requiresAction: record.requiresAction || false,
    requiresAdjustment: record.requiresAdjustment || false,
    requiresRepair: record.requiresRepair || false,
    temperature: record.temperature ?? undefined,
    humidity: record.humidity ?? undefined,
    approvedBy: record.approvedBy ?? undefined,
    notes: JSON.stringify(record.notes),
    supplierId: record.supplierId ?? "",
    measurementStandard: record.measurementStandard ?? "",
    calibrationAttempts: (record.calibrationAttempts || []) as z.infer<
      typeof calibrationAttempt
    >[],
    ...getCustomFields(record.customFields)
  };

  const navigate = useNavigate();

  return (
    <GaugeCalibrationRecordForm
      key={id}
      initialValues={initialValues}
      files={files}
      onClose={() => navigate(-1)}
    />
  );
}
