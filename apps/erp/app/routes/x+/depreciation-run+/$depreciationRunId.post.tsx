import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { getOrCreateAccountingPeriod } from "~/modules/accounting";
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

  const run = await client
    .from("depreciationRun")
    .select("*")
    .eq("id", depreciationRunId)
    .eq("companyId", companyId)
    .single();

  if (run.error || run.data.status !== "Draft") {
    throw redirect(
      path.to.depreciationRun(depreciationRunId),
      await flash(request, error(run.error, "Run is not in Draft status"))
    );
  }

  const [companySettingsResult, accountDefaultsResult] = await Promise.all([
    client
      .from("companySettings")
      .select("assetTaxDepreciationEnabled, assetTaxRate")
      .eq("id", companyId)
      .single(),
    client
      .from("accountDefault")
      .select("deferredTaxLiabilityAccountId, deferredTaxExpenseAccountId")
      .eq("companyId", companyId)
      .single()
  ]);

  const taxEnabled =
    (companySettingsResult.data as any)?.assetTaxDepreciationEnabled ?? false;
  const taxRate = (companySettingsResult.data as any)?.assetTaxRate
    ? Number((companySettingsResult.data as any).assetTaxRate)
    : null;
  const dtlAccountId = (accountDefaultsResult.data as any)
    ?.deferredTaxLiabilityAccountId;
  const dtExpenseAccountId = (accountDefaultsResult.data as any)
    ?.deferredTaxExpenseAccountId;

  const [linesResult, dimensionsResult] = await Promise.all([
    client
      .from("depreciationRunLine")
      .select(
        "id, fixedAssetId, amount, taxAmount, fixedAsset:fixedAssetId(id, fixedAssetId, locationId, fixedAssetClassId, acquisitionCost, accumulatedDepreciation, accumulatedTaxDepreciation, residualValuePercent, usefulLifeMonths, fixedAssetClass:fixedAssetClassId(depreciationExpenseAccountId, accumulatedDepreciationAccountId))"
      )
      .eq("depreciationRunId", depreciationRunId),
    client
      .from("dimension")
      .select("id, entityType")
      .eq("companyGroupId", companyGroupId)
      .eq("active", true)
  ]);

  if (linesResult.error) {
    throw redirect(
      path.to.depreciationRun(depreciationRunId),
      await flash(
        request,
        error(linesResult.error, "Failed to fetch run lines")
      )
    );
  }

  const locationDimensionId = (dimensionsResult.data ?? []).find(
    (d) => d.entityType === "Location"
  )?.id;

  const assetClassDimensionId = (dimensionsResult.data ?? []).find(
    (d) => d.entityType === "FixedAssetClass"
  )?.id;

  const postingDate = run.data.periodEnd;

  const accountingPeriod = await getOrCreateAccountingPeriod(
    client,
    companyId,
    postingDate
  );
  if (accountingPeriod.error) {
    throw redirect(
      path.to.depreciationRun(depreciationRunId),
      await flash(
        request,
        error(accountingPeriod.error, "Failed to get accounting period")
      )
    );
  }

  // Validate all lines have required account configuration
  for (const line of linesResult.data) {
    const asset = line.fixedAsset as any;
    const assetClass = asset?.fixedAssetClass;
    if (
      !assetClass?.depreciationExpenseAccountId ||
      !assetClass?.accumulatedDepreciationAccountId
    ) {
      throw redirect(
        path.to.depreciationRun(depreciationRunId),
        await flash(
          request,
          error(
            null,
            `Asset ${asset?.fixedAssetId ?? line.fixedAssetId} is missing depreciation account configuration`
          )
        )
      );
    }
  }

  const lines = linesResult.data.map((line) => {
    const asset = line.fixedAsset as any;
    const assetClass = asset.fixedAssetClass;
    return {
      id: line.id,
      fixedAssetId: line.fixedAssetId,
      amount: Number(line.amount),
      taxAmount: Number((line as any).taxAmount ?? 0),
      asset: {
        fixedAssetId: asset.fixedAssetId as string,
        locationId: asset.locationId as string | null,
        fixedAssetClassId: asset.fixedAssetClassId as string,
        acquisitionCost: Number(asset.acquisitionCost),
        accumulatedDepreciation: Number(asset.accumulatedDepreciation),
        accumulatedTaxDepreciation: Number(
          asset.accumulatedTaxDepreciation ?? 0
        ),
        residualValuePercent: Number(asset.residualValuePercent),
        depreciationExpenseAccountId:
          assetClass.depreciationExpenseAccountId as string,
        accumulatedDepreciationAccountId:
          assetClass.accumulatedDepreciationAccountId as string
      }
    };
  });

  try {
    await postDepreciationRun(getDatabaseClient(), {
      depreciationRunId,
      depreciationRunReadableId: run.data.depreciationRunId,
      postingDate,
      accountingPeriodId: accountingPeriod.data!,
      lines,
      locationDimensionId,
      assetClassDimensionId,
      taxEnabled,
      taxRate,
      dtlAccountId,
      dtExpenseAccountId,
      companyId,
      userId
    });
  } catch (err) {
    throw redirect(
      path.to.depreciationRun(depreciationRunId),
      await flash(request, error(err, "Failed to post depreciation run"))
    );
  }

  throw redirect(
    path.to.depreciationRun(depreciationRunId),
    await flash(request, success("Depreciation run posted"))
  );
}
