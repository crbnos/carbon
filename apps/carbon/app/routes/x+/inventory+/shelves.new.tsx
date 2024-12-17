import { assertIsPost, error } from "@carbon/auth";
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

// export const handle: Handle = {
//   breadcrumb: "Shelves",
//   to: path.to.shelves,
//   module: "inventory",
// };

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "inventory",
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(shelfValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const createShelf = await upsertShelf(client, {
    ...data,
    companyId,
    customFields: setCustomFields(formData),
    createdBy: userId,
  });
  if (createShelf.error) {
    return modal
      ? json(
          createShelf,
          await flash(
            request,
            error(createShelf.error, "Failed to insert shelf")
          )
        )
      : redirect(
          path.to.inventory,
          await flash(
            request,
            error(createShelf.error, "Failed to insert shelf")
          )
        );
  }

  // const shelfId = createShelf.data?.id;

  return modal ? json(createShelf) : redirect(path.to.inventory);
}

export async function clientAction({
  request,
  serverAction,
}: ClientActionFunctionArgs) {
  const companyId = getCompanyId();

  const formData = await request.clone().formData(); // if we don't clone it we can't access it in the action
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
