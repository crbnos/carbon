import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deleteFirstArticleInspection } from "~/modules/quality/firstArticle.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId } = await requirePermissions(request, {
    delete: "quality"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const result = await deleteFirstArticleInspection(getDatabaseClient(), {
    id,
    companyId
  });
  if (result.error) {
    throw redirect(
      path.to.firstArticle(id),
      await flash(request, error(result.error, result.error.message))
    );
  }

  throw redirect(
    path.to.firstArticles,
    await flash(request, success("First article deleted"))
  );
}
