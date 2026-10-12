// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { useCloseRoute } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import {
  changeNoticeRequiredActionValidator,
  getChangeNoticeRequiredAction,
  upsertChangeNoticeRequiredAction
} from "~/modules/items";
import { ChangeNoticeRequiredActionForm } from "~/modules/items/ui/ChangeNoticeActions";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const requiredAction = await getChangeNoticeRequiredAction(
    client,
    id,
    companyId
  );

  if (requiredAction.error) {
    throw redirect(
      path.to.changeNoticeRequiredActions,
      await flash(
        request,
        error(requiredAction.error, "Failed to get change notice action")
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
    changeNoticeRequiredActionValidator
  ).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...d } = validation.data;
  if (!id) throw new Error("id not found");

  const update = await upsertChangeNoticeRequiredAction(client, {
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
        error(update.error, "Failed to update change notice action")
      )
    );
  }

  throw redirect(
    path.to.changeNoticeRequiredActions,
    await flash(request, success("Updated change notice action"))
  );
}

export default function EditChangeNoticeRequiredActionRoute() {
  const { requiredAction } = useLoaderData<typeof loader>();
  const closeRoute = useCloseRoute();

  const initialValues = {
    id: requiredAction.id ?? undefined,
    name: requiredAction.name ?? "",
    active: requiredAction.active ?? true
  };

  return (
    <ChangeNoticeRequiredActionForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => closeRoute()}
    />
  );
}
