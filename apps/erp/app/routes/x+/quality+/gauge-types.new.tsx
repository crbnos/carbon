import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useNavigate } from "react-router";
import { gaugeTypeValidator, upsertGaugeType } from "~/modules/quality";
import GaugeTypeForm from "~/modules/quality/ui/GaugeTypes/GaugeTypeForm";
import { setCustomFields } from "~/utils/form";
import { getParams, path, requestReferrer } from "~/utils/path";

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
  const modal = formData.get("type") === "modal";

  const validation = await validator(gaugeTypeValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const insertGaugeType = await upsertGaugeType(client, {
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });
  if (insertGaugeType.error) {
    return modal
      ? insertGaugeType
      : redirect(
          requestReferrer(request) ??
            `${path.to.gaugeTypes}?${getParams(request)}`,
          await flash(
            request,
            error(insertGaugeType.error, "Failed to insert gauge type")
          )
        );
  }

  return modal
    ? insertGaugeType
    : redirect(
        `${path.to.gaugeTypes}?${getParams(request)}`,
        await flash(request, success("Non-conformance type created"))
      );
}

export default function NewCustomerStatusesRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: ""
  };

  return (
    <GaugeTypeForm initialValues={initialValues} onClose={() => navigate(-1)} />
  );
}
