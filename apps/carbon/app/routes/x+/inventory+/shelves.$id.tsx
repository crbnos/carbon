import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { shelfValidator, upsertShelf } from "~/modules/inventory";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { setCustomFields } from "~/utils/form";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

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
