import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { insertDepreciationRun } from "~/modules/accounting";
import {
  buildDepreciationLines,
  getNextPeriodEnd
} from "~/modules/accounting/accounting.utils";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
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

  const periodEnd = getNextPeriodEnd(lastPeriodEnd);

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

  const usageLogs = await client
    .from("fixedAssetUsageLog")
    .select("fixedAssetId, unitsProduced")
    .eq("periodEnd", periodEnd);

  const usageMap = new Map(
    (usageLogs.data ?? []).map((u) => [u.fixedAssetId, u])
  );

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
    usageMap
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
