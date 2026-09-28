import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { postDepreciationRun } from "~/modules/accounting/accounting.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      update: "accounting"
    });

  const { depreciationRunId } = params;
  if (!depreciationRunId) {
    throw redirect(
      path.to.depreciationRuns,
      await flash(request, error(null, "Missing depreciation run ID"))
    );
  }

  const result = await postDepreciationRun(client, getDatabaseClient(), {
    depreciationRunId,
    companyId,
    companyGroupId,
    userId
  });

  if (result.error) {
    throw redirect(
      path.to.depreciationRun(depreciationRunId),
      await flash(request, error(result.error.cause, result.error.flash))
    );
  }

  throw redirect(
    path.to.depreciationRun(depreciationRunId),
    await flash(request, success("Depreciation run posted"))
  );
}
