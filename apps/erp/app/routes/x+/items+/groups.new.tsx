// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import {
  itemPostingGroupValidator,
  upsertItemPostingGroup
} from "~/modules/items";
import { ItemPostingGroupForm } from "~/modules/items/ui/ItemPostingGroups";
import { setCustomFields } from "~/utils/form";
import { getParams, path } from "~/utils/path";

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
  const modal = formData.get("type") == "modal";

  const validation = await validator(itemPostingGroupValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...rest } = validation.data;

  const insertItemPostingGroup = await upsertItemPostingGroup(client, {
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

export default function NewItemPostingGroupsRoute() {
  const closeRoute = useCloseRoute();
  const initialValues = {
    name: "",
    description: ""
  };

  return (
    <ItemPostingGroupForm
      onClose={() => closeRoute()}
      initialValues={initialValues}
    />
  );
}
