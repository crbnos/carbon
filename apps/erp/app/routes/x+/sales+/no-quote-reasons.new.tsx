import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useNavigate } from "react-router";
import { noQuoteReasonValidator, upsertNoQuoteReason } from "~/modules/sales";
import NoQuoteReasonForm from "~/modules/sales/ui/NoQuoteReasons/NoQuoteReasonForm";

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

  const validation = await validator(noQuoteReasonValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const insertNoQuoteReason = await upsertNoQuoteReason(client, {
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });
  if (insertNoQuoteReason.error) {
    return modal
      ? insertNoQuoteReason
      : redirect(
          requestReferrer(request) ??
            `${path.to.noQuoteReasons}?${getParams(request)}`,
          await flash(
            request,
            error(insertNoQuoteReason.error, "Failed to insert no quote reason")
          )
        );
  }

  return modal
    ? insertNoQuoteReason
    : redirect(
        `${path.to.noQuoteReasons}?${getParams(request)}`,
        await flash(request, success("No quote reason created"))
      );
}

export default function NewCustomerStatusesRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: ""
  };

  return (
    <NoQuoteReasonForm
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
