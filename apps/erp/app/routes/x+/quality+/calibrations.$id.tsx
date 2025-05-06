import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  gaugeCalibrationRecordValidator,
  getGaugeCalibrationRecord,
  upsertGaugeCalibrationRecord,
} from "~/modules/quality";
import GaugeCalibrationRecordForm from "~/modules/quality/ui/Calibrations/GaugeCalibrationRecordForm";
import { getCustomFields, setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { getParams, path } from "~/utils/path";
export const handle: Handle = {
  breadcrumb: "Gauges",
  to: path.to.gauges,
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "quality",
    bypassRls: true,
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const [record] = await Promise.all([getGaugeCalibrationRecord(client, id)]);

  if (record.error) {
    throw redirect(
      path.to.gauges,
      await flash(
        request,
        error(record.error, "Failed to load gauge calibration record")
      )
    );
  }

  return json({
    record: record.data,
  });
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

  const { id, ...data } = validation.data;
  if (!id) throw new Error("Could not find id");

  const inspectionStatus =
    data.requiresAction || data.requiresAdjustment || data.requiresRepair
      ? "Fail"
      : "Pass";

  const updateGauge = await upsertGaugeCalibrationRecord(client, {
    id,
    ...data,
    inspectionStatus,
    companyId,
    updatedBy: userId,
    customFields: setCustomFields(formData),
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

  const { record } = useLoaderData<typeof loader>();

  const initialValues = {
    id: record.id || undefined,
    gaugeId: record.gaugeId || "",
    dateCalibrated: record.dateCalibrated || "",
    requiresAction: record.requiresAction || false,
    requiresAdjustment: record.requiresAdjustment || false,
    requiresRepair: record.requiresRepair || false,
    notes: JSON.stringify(record.notes),

    ...getCustomFields(record.customFields),
  };

  const navigate = useNavigate();

  return (
    <GaugeCalibrationRecordForm
      key={id}
      // @ts-ignore
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
