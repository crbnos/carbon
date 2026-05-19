import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { updateDocumentFavorite } from "~/modules/documents";
import { favoriteSchema } from "~/types/validators";

export async function action({ request }: ActionFunctionArgs) {
  await requirePermissions(request, {
    view: "purchasing"
  });

  const validation = await validator(favoriteSchema).validate(
    await request.formData()
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, favorite } = validation.data;

  const result = await updateDocumentFavorite({
    id,
    favorite: favorite === "favorite"
  });

  if (result.error) {
    return data(
      {},
      await flash(request, error(result, "Failed to favorite purchase order"))
    );
  }

  return {};
}
