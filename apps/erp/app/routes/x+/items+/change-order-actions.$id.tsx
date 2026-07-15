import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  changeOrderRequiredActionValidator,
  getChangeOrderRequiredAction,
  upsertChangeOrderRequiredAction
} from "~/modules/items";
import { ChangeOrderRequiredActionForm } from "~/modules/items/ui/ChangeOrderActions";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const requiredAction = await getChangeOrderRequiredAction(client, id);

  if (requiredAction.error) {
    throw redirect(
      path.to.changeOrderRequiredActions,
      await flash(
        request,
        error(requiredAction.error, "Failed to get change order action")
      )
    );
  }

  return {
    requiredAction: requiredAction.data
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(
    changeOrderRequiredActionValidator
  ).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const update = await upsertChangeOrderRequiredAction(client, {
    id,
    name: d.name,
    active: d.active,
    companyId,
    userId
  });

  if (update.error) {
    return data(
      {},
      await flash(
        request,
        error(update.error, "Failed to update change order action")
      )
    );
  }

  throw redirect(
    path.to.changeOrderRequiredActions,
    await flash(request, success("Updated change order action"))
  );
}

export default function EditChangeOrderRequiredActionRoute() {
  const { requiredAction } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: requiredAction.id ?? undefined,
    name: requiredAction.name ?? "",
    active: requiredAction.active ?? true
  };

  return (
    <ChangeOrderRequiredActionForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
