import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getOrCreateAccountingPeriod } from "~/modules/accounting";
import { postRevenueRecognitionRun } from "~/modules/accounting/accounting.server";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      update: "accounting"
    });

  const { runId } = params;
  if (!runId) {
    throw redirect(
      path.to.revenueRecognitionRuns,
      await flash(request, error(null, "Missing revenue recognition run ID"))
    );
  }

  const run = await client
    .from("revenueRecognitionRun")
    .select("*")
    .eq("id", runId)
    .eq("companyId", companyId)
    .single();

  if (run.error || run.data.status !== "Draft") {
    throw redirect(
      path.to.revenueRecognitionRun(runId),
      await flash(request, error(run.error, "Run is not in Draft status"))
    );
  }

  const postingDate = run.data.periodEnd;

  const [accountingPeriod, dimensionsResult] = await Promise.all([
    getOrCreateAccountingPeriod(client, companyId, postingDate, "accounting"),
    client
      .from("dimension")
      .select("id, entityType")
      .eq("companyGroupId", companyGroupId)
      .eq("active", true)
  ]);

  if (accountingPeriod.error || !accountingPeriod.data) {
    throw redirect(
      path.to.revenueRecognitionRun(runId),
      await flash(
        request,
        error(accountingPeriod.error, "Failed to get accounting period")
      )
    );
  }

  const dimensions = dimensionsResult.data ?? [];
  const dimensionIds = {
    customer: dimensions.find((d) => d.entityType === "Customer")?.id,
    item: dimensions.find((d) => d.entityType === "Item")?.id,
    location: dimensions.find((d) => d.entityType === "Location")?.id
  };

  try {
    await postRevenueRecognitionRun(getDatabaseClient(), {
      runId,
      companyId,
      userId,
      accountingPeriodId: accountingPeriod.data,
      postingDate,
      dimensionIds
    });
  } catch (err) {
    throw redirect(
      path.to.revenueRecognitionRun(runId),
      await flash(request, error(err, "Failed to post revenue recognition run"))
    );
  }

  throw redirect(
    path.to.revenueRecognitionRun(runId),
    await flash(request, success("Revenue recognition run posted"))
  );
}
