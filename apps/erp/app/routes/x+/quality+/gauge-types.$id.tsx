import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useLoaderData, useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  gaugeTypeValidator,
  getGaugeType,
  upsertGaugeType,
} from "~/modules/quality";
import GaugeTypeForm from "~/modules/quality/ui/GaugeTypes/GaugeTypeForm";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "quality",
    role: "employee",
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const gaugeType = await getGaugeType(client, id);

  if (gaugeType.error) {
    throw redirect(
      path.to.gaugeTypes,
      await flash(request, error(gaugeType.error, "Failed to get gauge type"))
    );
  }

  return json({
    gaugeType: gaugeType.data,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "quality",
  });

  const formData = await request.formData();
  const validation = await validator(gaugeTypeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;
  if (!id) throw new Error("id not found");

  const updateGaugeType = await upsertGaugeType(client, {
    id,
    ...data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });

  if (updateGaugeType.error) {
    return json(
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
    ...getCustomFields(gaugeType.customFields),
  };

  return (
    <GaugeTypeForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
