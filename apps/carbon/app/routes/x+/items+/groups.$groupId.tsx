import { validationError, validator } from "@carbon/form";
import { useLoaderData, useNavigate } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  ItemPostingGroupForm,
  getItemPostingGroup,
  itemPostingGroupValidator,
  upsertItemPostingGroup,
} from "~/modules/items";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { assertIsPost, notFound } from "~/utils/http";
import { getParams, path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "parts",
    role: "employee",
  });

  const { groupId } = params;
  if (!groupId) throw notFound("groupId not found");

  const itemPostingGroup = await getItemPostingGroup(client, groupId);

  return json({
    itemPostingGroup: itemPostingGroup?.data ?? null,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "parts",
  });

  const { groupId } = params;
  if (!groupId) throw new Error("Could not find groupId");

  const formData = await request.formData();
  const validation = await validator(itemPostingGroupValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateItemPostingGroup = await upsertItemPostingGroup(client, {
    id: groupId,
    ...validation.data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });

  if (updateItemPostingGroup.error) {
    return json(
      {},
      await flash(
        request,
        error(updateItemPostingGroup.error, "Failed to update item group")
      )
    );
  }

  throw redirect(
    `${path.to.itemPostingGroups}?${getParams(request)}`,
    await flash(request, success("Updated item group"))
  );
}

export default function EditItemPostingGroupsRoute() {
  const { itemPostingGroup } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: itemPostingGroup?.id ?? undefined,
    name: itemPostingGroup?.name ?? "",
    description: itemPostingGroup?.description ?? "",
    ...getCustomFields(itemPostingGroup?.customFields),
  };

  return (
    <ItemPostingGroupForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
