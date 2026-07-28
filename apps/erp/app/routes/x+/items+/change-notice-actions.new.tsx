import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useNavigate } from "react-router";
import {
  changeNoticeRequiredActionValidator,
  upsertChangeNoticeRequiredAction
} from "~/modules/items";
import { ChangeNoticeRequiredActionForm } from "~/modules/items/ui/ChangeNoticeActions";
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
    changeNoticeRequiredActionValidator
  ).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const insert = await upsertChangeNoticeRequiredAction(client, {
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
            `${path.to.changeNoticeRequiredActions}?${getParams(request)}`,
          await flash(
            request,
            error(insert.error, "Failed to insert change notice action")
          )
        );
  }

  return modal
    ? insert
    : redirect(
        `${path.to.changeNoticeRequiredActions}?${getParams(request)}`,
        await flash(request, success("Change notice action created"))
      );
}

export default function NewChangeNoticeRequiredActionRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    active: true
  };

  return (
    <ChangeNoticeRequiredActionForm
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
