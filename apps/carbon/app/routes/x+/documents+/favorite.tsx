import { validationError, validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@remix-run/node";
import { updateDocumentFavorite } from "~/modules/documents";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { favoriteSchema } from "~/types/validators";
import { error } from "~/utils/result";

export async function action({ request }: ActionFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {
    view: "purchasing",
  });

  const validation = await validator(favoriteSchema).validate(
    await request.formData()
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, favorite } = validation.data;

  const result = await updateDocumentFavorite(client, {
    id,
    favorite: favorite === "favorite",
    userId,
  });

  if (result.error) {
    return json(
      {},
      await flash(request, error(result, "Failed to favorite purchase order"))
    );
  }

  return json({});
}
