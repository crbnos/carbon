import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { getPreferenceHeaders } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { approveFirstArticleInspection } from "~/modules/quality/firstArticle.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "first-article", "approve");

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "quality"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const { locale } = getPreferenceHeaders(request);
  const result = await approveFirstArticleInspection(
    getDatabaseClient(),
    client,
    { id, companyId, userId, locale }
  );
  if (result.error) {
    logger.error("Failed to approve first article", {
      error: result.error,
      id,
      companyId
    });
    return data(
      {},
      await flash(request, error(result.error, result.error.message))
    );
  }

  throw redirect(
    path.to.firstArticle(id),
    await flash(request, success("First article approved"))
  );
}
