import { assertIsPost, error, getCarbonServiceRole } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { getLocalTimeZone, today } from "@internationalized/date";
import { useLoaderData } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { useUser } from "~/hooks";
import {
  gaugeValidator,
  getGaugeTypesList,
  upsertGauge,
} from "~/modules/quality";
import GaugeForm from "~/modules/quality/ui/Gauge/GaugeForm";

import { getNextSequence } from "~/modules/settings";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Gauges",
  to: path.to.gauges,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "quality",
  });

  const [types] = await Promise.all([getGaugeTypesList(client, companyId)]);

  return json({
    types: types.data ?? [],
  });
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

  const createGauge = await upsertGauge(client, {
    ...data,
    gaugeId,
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

  const id = createGauge.data?.id;
  if (!id) {
    throw redirect(
      path.to.gauges,
      await flash(request, error("Failed to insert gauge"))
    );
  }

  throw redirect(path.to.gauge(id!));
}

export default function GaugeNewRoute() {
  const { types } = useLoaderData<typeof loader>();

  const { defaults } = useUser();

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
  };

  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <GaugeForm initialValues={initialValues} gaugeTypes={types} />
    </div>
  );
}
