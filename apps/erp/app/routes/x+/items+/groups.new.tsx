import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { data, redirect, useNavigate } from "react-router";
import { itemPostingGroupValidator } from "~/modules/items";
import { upsertItemPostingGroup } from "~/modules/items/items.service.server";
import { ItemPostingGroupForm } from "~/modules/items/ui/ItemPostingGroups";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";
import { getCompanyId, itemPostingGroupsQuery } from "~/utils/react-query";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "parts"
  });

  return null;
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    create: "parts"
  });

  const formData = await request.formData();
  const modal = formData.get("type") == "modal";

  const validation = await validator(itemPostingGroupValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...rest } = validation.data;

  const insertItemPostingGroup = await upsertItemPostingGroup({
    ...rest,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });
  if (insertItemPostingGroup.error) {
    return data(
      {},
      await flash(
        request,
        error(insertItemPostingGroup.error, "Failed to insert item group")
      )
    );
  }

  const itemPostingGroupId = insertItemPostingGroup.data?.id;
  if (!itemPostingGroupId) {
    return data(
      {},
      await flash(
        request,
        error(insertItemPostingGroup, "Failed to insert item group")
      )
    );
  }

  return modal
    ? data(insertItemPostingGroup, { status: 201 })
    : redirect(
        `${path.to.itemPostingGroups}?${getParams(request)}`,
        await flash(request, success("Item posting group created"))
      );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    itemPostingGroupsQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function NewItemPostingGroupsRoute() {
  const navigate = useNavigate();
  const initialValues = {
    name: "",
    description: ""
  };

  return (
    <ItemPostingGroupForm
      onClose={() => navigate(-1)}
      initialValues={initialValues}
    />
  );
}
