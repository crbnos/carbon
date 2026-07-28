import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  changeNoticeTypeValidator,
  getChangeNoticeType,
  upsertChangeNoticeType
} from "~/modules/items";
import { ChangeNoticeTypeForm } from "~/modules/items/ui/ChangeNoticeTypes";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const changeNoticeType = await getChangeNoticeType(client, id, companyId);

  if (changeNoticeType.error) {
    throw redirect(
      path.to.changeNoticeTypes,
      await flash(
        request,
        error(changeNoticeType.error, "Failed to get change notice category")
      )
    );
  }

  return {
    changeNoticeType: changeNoticeType.data
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "parts"
  });

  const formData = await request.formData();
  const validation = await validator(changeNoticeTypeValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const update = await upsertChangeNoticeType(client, {
    id,
    ...d,
    companyId,
    updatedBy: userId
  });

  if (update.error) {
    return data(
      {},
      await flash(
        request,
        error(update.error, "Failed to update change notice category")
      )
    );
  }

  throw redirect(
    path.to.changeNoticeTypes,
    await flash(request, success("Updated change notice category"))
  );
}

export default function EditChangeNoticeTypeRoute() {
  const { changeNoticeType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: changeNoticeType.id ?? undefined,
    name: changeNoticeType.name ?? ""
  };

  return (
    <ChangeNoticeTypeForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
