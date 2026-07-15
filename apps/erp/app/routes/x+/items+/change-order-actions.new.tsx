import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useNavigate } from "react-router";
import {
  changeOrderRequiredActionValidator,
  upsertChangeOrderRequiredAction
} from "~/modules/items";
import { ChangeOrderRequiredActionForm } from "~/modules/items/ui/ChangeOrderActions";
import { getParams, path, requestReferrer } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "parts"
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(
    changeOrderRequiredActionValidator
  ).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const insert = await upsertChangeOrderRequiredAction(client, {
    name: validation.data.name,
    active: validation.data.active,
    companyId,
    userId
  });
  if (insert.error) {
    return modal
      ? insert
      : redirect(
          requestReferrer(request) ??
            `${path.to.changeOrderRequiredActions}?${getParams(request)}`,
          await flash(
            request,
            error(insert.error, "Failed to insert change order action")
          )
        );
  }

  return modal
    ? insert
    : redirect(
        `${path.to.changeOrderRequiredActions}?${getParams(request)}`,
        await flash(request, success("Change order action created"))
      );
}

export default function NewChangeOrderRequiredActionRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    active: true
  };

  return (
    <ChangeOrderRequiredActionForm
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
