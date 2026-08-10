import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { datetime } from "@carbon/utils";
import { parseDate } from "@internationalized/date";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useNavigate } from "react-router";
import { useCompanyToday, useRouteData, useUser } from "~/hooks";
import type { GaugeType } from "~/modules/quality";
import { gaugeValidator, insertGauge } from "~/modules/quality";
import GaugeForm from "~/modules/quality/ui/Gauge/GaugeForm";
import { getCompanyTimeZone } from "~/modules/shared/timezone.server";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "quality"
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "quality"
  });

  const formData = await request.formData();
  const validation = await validator(gaugeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id: _id, ...d } = validation.data;

  const companyToday = datetime.today(
    await getCompanyTimeZone(client, companyId)
  );
  const gaugeCalibrationStatus = d.nextCalibrationDate
    ? parseDate(d.nextCalibrationDate).compare(companyToday) < 0
      ? "Out-of-Calibration"
      : d.lastCalibrationDate
        ? "In-Calibration"
        : "Pending"
    : "Pending";

  const result = await insertGauge(client, {
    ...d,
    gaugeId: d.gaugeId || undefined,
    gaugeCalibrationStatus,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });

  if (result.error || !result.data) {
    throw redirect(
      path.to.gauges,
      await flash(request, error(result.error, "Failed to insert gauge"))
    );
  }

  throw redirect(
    `${path.to.gauges}?${getParams(request)}`,
    await flash(request, success(`Gauge ${result.data.gaugeId} created`))
  );
}

export default function GaugeNewRoute() {
  const { defaults } = useUser();
  const navigate = useNavigate();

  const routeData = useRouteData<{
    gaugeTypes: GaugeType[];
  }>(path.to.gauges);

  const companyToday = useCompanyToday();
  const initialValues = {
    id: undefined,
    gaugeId: undefined,
    supplierId: "",
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
      onClose={() => navigate(-1)}
    />
  );
}
