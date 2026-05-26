import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deleteAttributeCategory } from "~/modules/people/people.service.server";
import { path } from "~/utils/path";

export async function action({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    update: "people"
  });

  const { categoryId } = params;
  if (!categoryId) {
    throw redirect(
      path.to.attributes,
      await flash(request, error(params, "Failed to get a category id"))
    );
  }

  const deactivateAttribute = await deleteAttributeCategory(categoryId);
  if (deactivateAttribute.error) {
    throw redirect(
      path.to.attributes,
      await flash(
        request,
        error(
          deactivateAttribute.error,
          "Failed to deactivate attribute category"
        )
      )
    );
  }

  throw redirect(
    path.to.attributes,
    await flash(request, success("Successfully deactivated attribute category"))
  );
}
