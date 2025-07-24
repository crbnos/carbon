import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ClientActionFunctionArgs } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { shelfValidator, upsertShelf } from "~/modules/inventory";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";
import { getCompanyId, shelvesQuery } from "~/utils/react-query";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    create: "inventory",
  });

  const formData = await request.formData();
  const validation = await validator(shelfValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  if (!id) {
    throw redirect(
      path.to.inventory,
      await flash(request, error(null, "Failed to update shelf"))
    );
  }

  const update = await upsertShelf(client, {
    id,
    ...data,
    customFields: setCustomFields(formData),
    updatedBy: userId,
  });
  if (update.error) {
    throw redirect(
      path.to.inventory,
      await flash(request, error(update.error, "Failed to update shelf"))
    );
  }

  return json(null, await flash(request, success("Updated shelf")));
}

export async function clientAction({
  request,
  serverAction,
}: ClientActionFunctionArgs) {
  const companyId = getCompanyId();

  const formData = await request.clone().formData(); // if we. don't clone it we can't access it in the action
  const validation = await validator(shelfValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  if (companyId && validation.data.locationId) {
    window.clientCache?.setQueryData(
      shelvesQuery(companyId, validation.data.locationId).queryKey,
      null
    );
  }
  return await serverAction();
}
