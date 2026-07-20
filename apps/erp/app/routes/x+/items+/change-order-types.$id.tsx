import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  changeOrderTypeValidator,
  getChangeOrderType,
  upsertChangeOrderType
} from "~/modules/items";
import { ChangeOrderTypeForm } from "~/modules/items/ui/ChangeOrderTypes";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const changeOrderType = await getChangeOrderType(client, id);

  if (changeOrderType.error) {
    throw redirect(
      path.to.changeOrderTypes,
      await flash(
        request,
        error(changeOrderType.error, "Failed to get change order category")
      )
    );
  }

  return {
    changeOrderType: changeOrderType.data
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(changeOrderTypeValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const update = await upsertChangeOrderType(client, {
    id,
    ...d,
    updatedBy: userId
  });

  if (update.error) {
    return data(
      {},
      await flash(
        request,
        error(update.error, "Failed to update change order category")
      )
    );
  }

  throw redirect(
    path.to.changeOrderTypes,
    await flash(request, success("Updated change order category"))
  );
}

export default function EditChangeOrderTypeRoute() {
  const { changeOrderType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: changeOrderType.id ?? undefined,
    name: changeOrderType.name ?? ""
  };

  return (
    <ChangeOrderTypeForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
