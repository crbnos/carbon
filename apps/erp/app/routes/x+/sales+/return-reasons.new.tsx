import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useNavigate } from "react-router";
import { returnReasonValidator, upsertReturnReason } from "~/modules/sales";
import ReturnReasonForm from "~/modules/sales/ui/ReturnReasons/ReturnReasonForm";

import { setCustomFields } from "~/utils/form";
import { getParams, path, requestReferrer } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "sales"
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales"
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(returnReasonValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: id is stripped for insert
  const { id, ...d } = validation.data;

  const insertReturnReason = await upsertReturnReason(client, {
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });
  if (insertReturnReason.error) {
    return modal
      ? insertReturnReason
      : redirect(
          requestReferrer(request) ??
            `${path.to.returnReasons}?${getParams(request)}`,
          await flash(
            request,
            error(insertReturnReason.error, "Failed to insert return reason")
          )
        );
  }

  return modal
    ? insertReturnReason
    : redirect(
        `${path.to.returnReasons}?${getParams(request)}`,
        await flash(request, success("Return reason created"))
      );
}

export default function NewReturnReasonRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    inventoryValueZero: false
  };

  return (
    <ReturnReasonForm
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
