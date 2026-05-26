import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import { itemPostingGroupValidator } from "~/modules/items";
import {
  getItemPostingGroup,
  upsertItemPostingGroup
} from "~/modules/items/items.service.server";
import { ItemPostingGroupForm } from "~/modules/items/ui/ItemPostingGroups";
import { getCustomFields, setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";
import { getCompanyId, itemPostingGroupsQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const { groupId } = params;
  if (!groupId) throw notFound("groupId not found");

  const itemPostingGroup = await getItemPostingGroup(groupId);

  return {
    itemPostingGroup: itemPostingGroup?.data ?? null
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { userId } = await requirePermissions(request, {
    update: "parts"
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

  const updateItemPostingGroup = await upsertItemPostingGroup({
    id: groupId,
    ...validation.data,
    updatedBy: userId,
    customFields: setCustomFields(formData)
  });

  if (updateItemPostingGroup.error) {
    return data(
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

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  const companyId = getCompanyId();

  window.clientCache?.invalidateQueries({
    predicate: (query) => {
      const queryKey = query.queryKey as string[];
      return (
        queryKey[0] === itemPostingGroupsQuery(companyId).queryKey[0] &&
        queryKey[1] === companyId
      );
    }
  });

  return await serverAction();
}

export default function EditItemPostingGroupsRoute() {
  const { itemPostingGroup } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: itemPostingGroup?.id ?? undefined,
    name: itemPostingGroup?.name ?? "",
    description: itemPostingGroup?.description ?? "",
    ...getCustomFields(itemPostingGroup?.customFields)
  };

  return (
    <ItemPostingGroupForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(-1)}
    />
  );
}
