import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { shelfValidator, upsertShelf } from "~/modules/inventory";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

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
