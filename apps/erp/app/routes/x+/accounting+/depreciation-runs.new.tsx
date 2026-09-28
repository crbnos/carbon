import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { endOfMonth, parseDate } from "@internationalized/date";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  depreciationRunValidator,
  getBaseCurrencyDecimalPlaces,
  insertDepreciationRun
} from "~/modules/accounting";
import {
  buildDepreciationLines,
  getNextPeriodEnd
} from "~/modules/accounting/accounting.utils";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, {
      create: "accounting"
    });

  // Find the last run (posted or draft) to determine the next period
  const lastRun = await client
    .from("depreciationRun")
    .select("periodEnd, status")
    .eq("companyId", companyId)
    .order("periodEnd", { ascending: false })
    .limit(1);

  const lastPeriodEnd =
    lastRun.data && lastRun.data.length > 0 ? lastRun.data[0].periodEnd : null;

  // The list page posts the period the user picked; a bare POST falls back to
  // the period after the last run. Depreciation is monthly, so the picked
  // date snaps to its month end, and it must come after the last run — the
  // calculation depreciates every month from the last posted run up to it.
  const validation = await validator(depreciationRunValidator).validate(
    await request.formData()
  );
  const periodEnd = validation.error
    ? getNextPeriodEnd(lastPeriodEnd)
    : endOfMonth(parseDate(validation.data.periodEnd)).toString();

  if (lastPeriodEnd && periodEnd <= lastPeriodEnd) {
    throw redirect(
      path.to.depreciationRuns,
      await flash(
        request,
        error(null, "The period must end after the last depreciation run")
      )
    );
  }

  // Check for existing run at this period
  const existing = await client
    .from("depreciationRun")
    .select("id")
    .eq("periodEnd", periodEnd)
    .eq("companyId", companyId);

  if (existing.data && existing.data.length > 0) {
    throw redirect(
      path.to.depreciationRuns,
      await flash(
        request,
        error(null, "A depreciation run already exists for this period")
      )
    );
  }

  const companySettings = await client
    .from("companySettings")
    .select("assetTaxDepreciationEnabled")
    .eq("id", companyId)
    .single();

  const taxEnabled =
    (companySettings.data as any)?.assetTaxDepreciationEnabled ?? false;

  const assets = await client
    .from("fixedAsset")
    .select("*")
    .eq("companyId", companyId)
    .eq("status", "Active");

  if (assets.error) {
    throw redirect(
      path.to.depreciationRuns,
      await flash(request, error(assets.error, "Failed to fetch assets"))
    );
  }

  // For depreciation calculation, use last *posted* run
  const lastPostedRun = await client
    .from("depreciationRun")
    .select("periodEnd")
    .eq("companyId", companyId)
    .eq("status", "Posted")
    .order("periodEnd", { ascending: false })
    .limit(1);

  const lastPostedPeriodEnd =
    lastPostedRun.data && lastPostedRun.data.length > 0
      ? lastPostedRun.data[0].periodEnd
      : null;

  // A run can cover several months (a picked later period), so units of
  // production sums every usage log since the last posted run.
  let usageQuery = client
    .from("fixedAssetUsageLog")
    .select("fixedAssetId, unitsProduced")
    .eq("companyId", companyId)
    .lte("periodEnd", periodEnd);
  if (lastPostedPeriodEnd) {
    usageQuery = usageQuery.gt("periodEnd", lastPostedPeriodEnd);
  }
  const usageLogs = await usageQuery;

  const usageMap = new Map<string, { unitsProduced: number }>();
  for (const u of usageLogs.data ?? []) {
    const current = usageMap.get(u.fixedAssetId)?.unitsProduced ?? 0;
    usageMap.set(u.fixedAssetId, {
      unitsProduced: current + Number(u.unitsProduced)
    });
  }

  const lines = buildDepreciationLines(
    (assets.data ?? []).map((a) => ({
      ...a,
      accumulatedTaxDepreciation: Number(
        (a as any).accumulatedTaxDepreciation ?? 0
      ),
      taxDepreciationMethod: (a as any).taxDepreciationMethod ?? null,
      taxUsefulLifeMonths: (a as any).taxUsefulLifeMonths ?? null,
      taxResidualValuePercent: (a as any).taxResidualValuePercent ?? null,
      macrsPropertyClass: (a as any).macrsPropertyClass ?? null,
      macrsConvention: (a as any).macrsConvention ?? null,
      bonusDepreciationPercent: (a as any).bonusDepreciationPercent ?? null
    })),
    periodEnd,
    lastPostedPeriodEnd,
    taxEnabled,
    usageMap,
    await getBaseCurrencyDecimalPlaces(client, companyId, companyGroupId)
  );

  const result = await insertDepreciationRun(client, {
    periodEnd,
    lines,
    companyId,
    createdBy: userId
  });

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
