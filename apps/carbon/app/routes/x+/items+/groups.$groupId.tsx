import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  ItemGroupForm,
  getItemGroup,
  itemGroupValidator,
  upsertItemGroup,
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

  const itemGroup = await getItemGroup(client, groupId);

  return json({
    itemGroup: itemGroup?.data ?? null,
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
  const validation = await validator(itemGroupValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const updateItemGroup = await upsertItemGroup(client, {
    id: groupId,
    ...validation.data,
    updatedBy: userId,
    customFields: setCustomFields(formData),
  });

  if (updateItemGroup.error) {
    return json(
      {},
      await flash(
        request,
        error(updateItemGroup.error, "Failed to update item group")
      )
    );
  }

  throw redirect(
    `${path.to.itemGroups}?${getParams(request)}`,
    await flash(request, success("Updated item group"))
  );
}

export default function EditItemGroupsRoute() {
  const { itemGroup } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: itemGroup?.id ?? undefined,
    name: itemGroup?.name ?? "",
    description: itemGroup?.description ?? "",
    ...getCustomFields(itemGroup?.customFields),
  };

  return (
    <ItemGroupForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
