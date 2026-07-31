import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useNavigate } from "react-router";
import {
  changeNoticeTypeValidator,
  upsertChangeNoticeType
} from "~/modules/items";
import { ChangeNoticeTypeForm } from "~/modules/items/ui/ChangeNoticeTypes";
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

  const validation = await validator(changeNoticeTypeValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const insert = await upsertChangeNoticeType(client, {
    name: validation.data.name,
    companyId,
    createdBy: userId
  });
  if (insert.error) {
    return modal
      ? insert
      : redirect(
          requestReferrer(request) ??
            `${path.to.changeNoticeTypes}?${getParams(request)}`,
          await flash(
            request,
            error(insert.error, "Failed to insert change notice category")
          )
        );
  }

  return modal
    ? insert
    : redirect(
        `${path.to.changeNoticeTypes}?${getParams(request)}`,
        await flash(request, success("Change notice category created"))
      );
}

export default function NewChangeNoticeTypeRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: ""
  };

  return (
    <ChangeNoticeTypeForm
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
