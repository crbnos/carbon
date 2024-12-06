import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  itemPostingGroupValidator,
  upsertItemPostingGroup,
} from "~/modules/items";
import { ItemPostingGroupForm } from "~/modules/items/ui/ItemPostingGroups";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

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
