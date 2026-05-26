import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useUrlParams } from "@carbon/react";
import { getLocalTimeZone, today } from "@internationalized/date";
import type { FileObject } from "@supabase/storage-js";
import { nanoid } from "nanoid";
import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { gaugeCalibrationRecordValidator } from "~/modules/quality";
import {
  getQualityFiles,
  upsertGaugeCalibrationRecord
} from "~/modules/quality/quality.service.server";
import GaugeCalibrationRecordForm from "~/modules/quality/ui/Calibrations/GaugeCalibrationRecordForm";

import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "quality"
  });

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const gaugeId = url.searchParams.get("gaugeId");

  if (id) {
    return {
      id,
      gaugeId,
      files: await getQualityFiles(id)
    };
  }

  return {
    id: nanoid(),
    gaugeId,
    files: [] as FileObject[]
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

  const d = validation.data;

  const inspectionStatus =
    d.requiresAction || d.requiresAdjustment || d.requiresRepair
      ? "Fail"
      : "Pass";

  const createGauge = await upsertGaugeCalibrationRecord({
    ...d,
    inspectionStatus,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
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
  const { files, id, gaugeId } = useLoaderData<typeof loader>();
  const [params, setParams] = useUrlParams();

  useEffect(() => {
    if (params.get("id") !== id) {
      setParams({
        id,
        ...(gaugeId ? { gaugeId } : {})
      });
    }
  }, [id, gaugeId, params, setParams]);

  const initialValues = {
    id,
    gaugeId: gaugeId ?? "",
    dateCalibrated: today(getLocalTimeZone()).toString(),
    requiresAction: false,
    requiresAdjustment: false,
    requiresRepair: false,
    temperature: undefined,
    humidity: undefined,
    approvedBy: undefined,
    notes: "{}",
    calibrationAttempts: []
  };

  return (
    <GaugeCalibrationRecordForm
      initialValues={initialValues}
      files={files}
      onClose={() => navigate(path.to.calibrations)}
    />
  );
}
