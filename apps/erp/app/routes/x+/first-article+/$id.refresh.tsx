import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { refreshFirstArticleProducts } from "~/modules/quality/firstArticle.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "quality"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const result = await refreshFirstArticleProducts(
    getDatabaseClient(),
    client,
    {
      id,
      companyId,
      userId
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
    await flash(
      request,
      success(
        result.data.inserted === 0
          ? "Form 2 is up to date"
          : `Added ${result.data.inserted} row(s) from traceability`
      )
    )
  );
}
