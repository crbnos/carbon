import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import { gaugeTypeValidator } from "~/modules/quality";
import {
  getGaugeType,
  upsertGaugeType
} from "~/modules/quality/quality.service.server";
import GaugeTypeForm from "~/modules/quality/ui/GaugeTypes/GaugeTypeForm";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "quality",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const gaugeType = await getGaugeType(id);

  if (gaugeType.error) {
    throw redirect(
      path.to.gaugeTypes,
      await flash(request, error(gaugeType.error, "Failed to get gauge type"))
    );
  }

  return {
    gaugeType: gaugeType.data
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "quality"
  });

  const formData = await request.formData();
  const validation = await validator(gaugeTypeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const updateGaugeType = await upsertGaugeType({
    id,
    ...d,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateGaugeType.error) {
    return data(
      {},
      await flash(
        request,
        error(updateGaugeType.error, "Failed to update gauge type")
      )
    );
  }

  throw redirect(
    path.to.gaugeTypes,
    await flash(request, success("Updated gauge type"))
  );
}

export default function EditGaugeTypeRoute() {
  const { gaugeType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: gaugeType.id ?? undefined,
    name: gaugeType.name ?? "",
    ...getCustomFields(gaugeType.customFields)
  };

  return (
    <GaugeTypeForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
