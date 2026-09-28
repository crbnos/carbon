import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import invariant from "tiny-invariant";
import { getFirstArticleInspectionByLot } from "~/modules/quality";
import { dispositionInspection } from "~/modules/quality/quality.server";
import { getParams, path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "quality",
    role: "employee"
  });
  const { id } = params;
  invariant(id, "id is required");

  // A First Article lot is verdict-only too, and one-shot: its FAI's Verify
  // snapshots the verdict, so it must not change underneath it.
  const firstArticle = (
    await getFirstArticleInspectionByLot(client, id, companyId)
  ).data;

  const result = await dispositionInspection({
    id,
    decision: "Accept",
    companyId,
    dispositionedBy: userId,
    // ERP verdict carries no production posting — Receipt (and First Article)
    // lots only. Job Operation lots are dispositioned (with their physical
    // outcome) by the MES route.
    requireSource: firstArticle ? "First Article" : "Receipt",
    requireOpen: !!firstArticle
  });

  if (result.error) {
    throw redirect(
      path.to.inspection(id),
      await flash(request, error(result.error, "Failed to accept lot"))
    );
  }

  if (firstArticle) {
    throw redirect(
      path.to.firstArticle(firstArticle.id),
      await flash(request, success("First article accepted"))
    );
  }

  throw redirect(
    `${path.to.inspections}?${getParams(request)}`,
    await flash(request, success("Lot accepted"))
  );
}
