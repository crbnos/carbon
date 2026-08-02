import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { cancelNettingStatement } from "~/modules/accounting";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const { id } = params;
  if (!id) throw redirect(`${path.to.intercompany}?tab=netting`);

  const result = await cancelNettingStatement(client, id, userId);
  if (result.error) {
    throw redirect(
      path.to.intercompanyNettingStatement(id),
      await flash(
        request,
        error(result.error, "Failed to cancel netting statement")
      )
    );
  }

  throw redirect(
    `${path.to.intercompany}?tab=netting`,
    await flash(request, success("Netting statement cancelled"))
  );
}
