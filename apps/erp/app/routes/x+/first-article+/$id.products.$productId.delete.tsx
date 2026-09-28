import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { deleteFirstArticleInspectionProduct } from "~/modules/quality/firstArticle.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId } = await requirePermissions(request, {
    update: "quality"
  });

  const { id, productId } = params;
  if (!id || !productId) throw new Error("Could not find id");

  const result = await deleteFirstArticleInspectionProduct(
    getDatabaseClient(),
    {
      id: productId,
      firstArticleInspectionId: id,
      companyId
    }
  );
  if (result.error) {
    return data(
      {},
      await flash(request, error(result.error, result.error.message))
    );
  }

  throw redirect(
    path.to.firstArticle(id),
    await flash(request, success("Row deleted"))
  );
}
