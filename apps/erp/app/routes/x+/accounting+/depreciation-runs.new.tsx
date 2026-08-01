import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { createDepreciationRunProposal } from "~/modules/accounting";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const result = await createDepreciationRunProposal(client, {
    companyId,
    userId
  });

  if (result.alreadyExists) {
    throw redirect(
      path.to.depreciationRuns,
      await flash(
        request,
        error(null, "A depreciation run already exists for this period")
      )
    );
  }

  if (result.error || !result.data) {
    throw redirect(
      path.to.depreciationRuns,
      await flash(
        request,
        error(result.error, "Failed to create depreciation run")
      )
    );
  }

  throw redirect(
    path.to.depreciationRun(result.data.id),
    await flash(request, success("Depreciation run created"))
  );
}
