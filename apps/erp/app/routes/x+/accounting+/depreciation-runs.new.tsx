import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { createDepreciationRun } from "~/modules/accounting/accounting.server";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      create: "accounting"
    });

  const result = await createDepreciationRun(client, {
    companyId,
    companyGroupId,
    userId
  });

  if (result.error) {
    throw redirect(
      path.to.depreciationRuns,
      await flash(request, error(result.error.cause, result.error.flash))
    );
  }

  throw redirect(
    path.to.depreciationRun(result.data.id),
    await flash(request, success("Depreciation run created"))
  );
}
