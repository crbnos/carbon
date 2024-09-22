import { validationError, validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { updateQuoteFavorite } from "~/modules/sales";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { favoriteSchema } from "~/types/validators";
import { error } from "~/utils/result";

export async function action({ request }: ActionFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {
    view: "sales",
  });

  const validation = await validator(favoriteSchema).validate(
    await request.formData()
  );
  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, favorite } = validation.data;

  const result = await updateQuoteFavorite(client, {
    id,
    favorite: favorite === "favorite",
    userId,
  });

  if (result.error) {
    return json(
      {},
      await flash(request, error(result, "Failed to favorite Quote"))
    );
  }

  return json({});
}
