import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { json, type ActionFunctionArgs } from "@vercel/remix";
import { updateSalesRFQFavorite } from "~/modules/sales";
import { favoriteSchema } from "~/types/validators";

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

  const result = await updateSalesRFQFavorite(client, {
    id,
    favorite: favorite === "favorite",
    userId,
  });

  if (result.error) {
    return json(
      {},
      await flash(request, error(result, "Failed to favorite rfq"))
    );
  }

  return json({});
}
