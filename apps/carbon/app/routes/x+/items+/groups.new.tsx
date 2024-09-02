import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useNavigate } from "@remix-run/react";
import {
  ItemPostingGroupForm,
  itemPostingGroupValidator,
  upsertItemPostingGroup,
} from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { getParams, path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "parts",
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "parts",
  });

  const formData = await request.formData();
  const modal = formData.get("type") == "modal";

  const validation = await validator(itemPostingGroupValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const insertItemPostingGroup = await upsertItemPostingGroup(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });
  if (insertItemPostingGroup.error) {
    return json(
      {},
      await flash(
        request,
        error(insertItemPostingGroup.error, "Failed to insert item group")
      )
    );
  }

  const itemPostingGroupId = insertItemPostingGroup.data?.id;
  if (!itemPostingGroupId) {
    return json(
      {},
      await flash(
        request,
        error(insertItemPostingGroup, "Failed to insert item group")
      )
    );
  }

  return modal
    ? json(insertItemPostingGroup, { status: 201 })
    : redirect(
        `${path.to.itemPostingGroups}?${getParams(request)}`,
        await flash(request, success("Item posting group created"))
      );
}

export default function NewItemPostingGroupsRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    description: "",
  };

  return (
    <ItemPostingGroupForm
      onClose={() => navigate(-1)}
      initialValues={initialValues}
    />
  );
}
