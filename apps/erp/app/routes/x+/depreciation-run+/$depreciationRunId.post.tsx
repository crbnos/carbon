// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { buildDepreciationRunLines } from "~/modules/accounting";
import {
  futureRunPeriodError,
  postDepreciationRun,
  resolveRunPostingPeriods
} from "~/modules/accounting/accounting.server";
import { depreciationRunLinesMatch } from "~/modules/accounting/accounting.utils";
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

  const futureError = await futureRunPeriodError(
    client,
    companyId,
    run.data.periodEnd
  );
  if (futureError) {
    throw redirect(
      path.to.depreciationRun(depreciationRunId),
      await flash(request, error(null, futureError))
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
        "id, fixedAssetId, periodEnd, amount, taxAmount, fixedAsset:fixedAssetId(id, fixedAssetId, locationId, fixedAssetClassId, acquisitionCost, accumulatedDepreciation, accumulatedTaxDepreciation, residualValuePercent, usefulLifeMonths, fixedAssetClass:fixedAssetClassId(depreciationExpenseAccountId, accumulatedDepreciationAccountId))"
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

  // A Draft is computed once. An asset disposed, added or re-valued since —
  // or a later period posted first — makes it post the wrong depreciation.
  const proposal = await buildDepreciationRunLines(client, {
    companyId,
    companyGroupId,
    periodEnd: run.data.periodEnd,
    runId: depreciationRunId
  });
  if (!proposal.data) {
    throw redirect(
      path.to.depreciationRun(depreciationRunId),
      await flash(
        request,
        error(proposal.error, "Failed to calculate depreciation")
      )
    );
  }
  if (proposal.data.laterPostedRunId) {
    throw redirect(
      path.to.depreciationRun(depreciationRunId),
      await flash(
        request,
        error(
          null,
          `${proposal.data.laterPostedRunId} is already posted for a later period and includes these months; delete ${run.data.depreciationRunId}`
        )
      )
    );
  }
  if (
    !depreciationRunLinesMatch(
      linesResult.data.map((line) => ({
        ...line,
        periodEnd: line.periodEnd ?? run.data.periodEnd
      })),
      proposal.data.lines
    )
  ) {
    throw redirect(
      path.to.depreciationRun(depreciationRunId),
      await flash(
        request,
        error(
          null,
          `Depreciation run ${run.data.depreciationRunId} is out of date with the fixed assets; recalculate it before posting`
        )
      )
    );
  }

  const locationDimensionId = (dimensionsResult.data ?? []).find(
    (d) => d.entityType === "Location"
  )?.id;

  const assetClassDimensionId = (dimensionsResult.data ?? []).find(
    (d) => d.entityType === "FixedAssetClass"
  )?.id;

  // A line from before per-month lines has no periodEnd: it is the run's.
  const lineMonth = (line: { periodEnd: string | null }) =>
    line.periodEnd ?? run.data.periodEnd;

  // Each month posts in its own period (the run's when that month is Closed).
  const periods = await resolveRunPostingPeriods(client, {
    companyId,
    monthEnds: linesResult.data.map(lineMonth),
    runPeriodEnd: run.data.periodEnd
  });
  if (!periods.data) {
    throw redirect(
      path.to.depreciationRun(depreciationRunId),
      await flash(
        request,
        error(periods.error, "Failed to get accounting period")
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
      periodEnd: lineMonth(line),
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
      periods: periods.data,
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
