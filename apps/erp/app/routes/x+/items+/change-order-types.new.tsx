import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useNavigate } from "react-router";
import {
  changeOrderTypeValidator,
  upsertChangeOrderType
} from "~/modules/items";
import { ChangeOrderTypeForm } from "~/modules/items/ui/ChangeOrderTypes";
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

  const validation = await validator(changeOrderTypeValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const insert = await upsertChangeOrderType(client, {
    name: validation.data.name,
    companyId,
    createdBy: userId
  });
  if (insert.error) {
    return modal
      ? insert
      : redirect(
          requestReferrer(request) ??
            `${path.to.changeOrderTypes}?${getParams(request)}`,
          await flash(
            request,
            error(insert.error, "Failed to insert change order category")
          )
        );
  }

  return modal
    ? insert
    : redirect(
        `${path.to.changeOrderTypes}?${getParams(request)}`,
        await flash(request, success("Change order category created"))
      );
}

export default function NewChangeOrderTypeRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: ""
  };

  return (
    <ChangeOrderTypeForm
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
