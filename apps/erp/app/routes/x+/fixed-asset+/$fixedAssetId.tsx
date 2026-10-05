// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { JSONContent } from "@carbon/react";
import {
  Badge,
  BarProgress,
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "@carbon/react";
import { isUnaffectedByNavigation, redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { ReactNode } from "react";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { Link, Outlet, useLoaderData, useParams } from "react-router";
import { DateTime } from "~/components";
import { DocumentPage, DocumentSidebar } from "~/components/DocumentPage";
import { Enumerable } from "~/components/Enumerable";
import { useSettings, useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import {
  CONSTRUCTION_IN_PROGRESS_ENABLED,
  getAssetDepreciationHistory,
  getFixedAsset,
  getFixedAssetCipCosts,
  getFixedAssetDisposal,
  getFixedAssetRelatedItems,
  getFixedAssetTransfers
} from "~/modules/accounting";
import {
  DepreciationRunStatus,
  FixedAssetCipCosts,
  FixedAssetDocuments,
  FixedAssetHeader,
  FixedAssetNotes
} from "~/modules/accounting/ui/FixedAssets";
import { getWorkCenter } from "~/modules/resources";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Fixed Assets`, to: path.to.fixedAssets },
    (data) => data?.asset?.fixedAssetId
  ),
  module: "accounting"
};

export const shouldRevalidate: ShouldRevalidateFunction = (args) =>
  isUnaffectedByNavigation(args, { params: ["fixedAssetId"] })
    ? false
    : args.defaultShouldRevalidate;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });

  const { fixedAssetId } = params;
  if (!fixedAssetId) throw new Error("Could not find fixedAssetId");

  const [asset, depreciationHistory, disposal, transfers, cipCosts] =
    await Promise.all([
      getFixedAsset(client, fixedAssetId, companyId),
      getAssetDepreciationHistory(client, fixedAssetId),
      getFixedAssetDisposal(client, fixedAssetId),
      getFixedAssetTransfers(client, fixedAssetId, companyId),
      getFixedAssetCipCosts(client, fixedAssetId, companyId)
    ]);

  if (asset.error) {
    throw redirect(
      path.to.fixedAssets,
      await flash(request, error(asset.error, "Failed to load fixed asset"))
    );
  }

  const assetClass = asset.data.fixedAssetClass as {
    isConstructionInProgress?: boolean;
  } | null;

  // The readable job numbers behind the CIP cost rows — one lookup for the set.
  const cipJobIds = [
    ...new Set(
      (cipCosts.data ?? [])
        .map((cost) => cost.jobId)
        .filter((id): id is string => Boolean(id))
    )
  ];

  const [workCenter, cipJobs] = await Promise.all([
    asset.data.workCenterId
      ? getWorkCenter(client, asset.data.workCenterId)
      : null,
    cipJobIds.length > 0
      ? client
          .from("job")
          .select("id, jobId")
          .eq("companyId", companyId)
          .in("id", cipJobIds)
      : null
  ]);

  // The documents around the asset stream in after the page renders: the
  // jobs that built it (its transfers and cost rows name them), the order,
  // invoice and rental lines on it, and its disposal journal.
  const relatedJobIds = [
    ...(transfers.data ?? []).map((transfer) => transfer.jobId),
    ...cipJobIds
  ].filter((id): id is string => Boolean(id));

  return {
    asset: asset.data,
    // Drives the CIP cost card and the header's Attach Job / Capitalize; all
    // hidden while construction in progress is.
    isCipClass:
      CONSTRUCTION_IN_PROGRESS_ENABLED &&
      Boolean(assetClass?.isConstructionInProgress),
    workCenterName: workCenter?.data?.name ?? null,
    // Each line is one month of a run; a line from before per-month lines
    // has no periodEnd and is the run's.
    depreciationHistory: (depreciationHistory.data ?? [])
      .map((line) => ({
        ...line,
        periodEnd:
          line.periodEnd ??
          (line.depreciationRun as { periodEnd: string } | null)?.periodEnd ??
          null
      }))
      .sort((a, b) => (b.periodEnd ?? "").localeCompare(a.periodEnd ?? "")),
    disposal: disposal.data,
    transfers: transfers.data ?? [],
    cipCosts: cipCosts.data ?? [],
    cipJobReadableIds: Object.fromEntries(
      (cipJobs?.data ?? []).map((job) => [job.id, job.jobId])
    ) as Record<string, string>,
    relatedItems: getFixedAssetRelatedItems(client, companyId, {
      fixedAssetId,
      itemId: asset.data.itemId,
      trackedEntityId: asset.data.trackedEntityId,
      jobIds: relatedJobIds,
      disposalJournalId: disposal.data?.journalId ?? null
    })
  };
}

export default function FixedAssetDetailRoute() {
  const { fixedAssetId } = useParams();
  const {
    asset,
    isCipClass,
    workCenterName,
    depreciationHistory,
    disposal,
    transfers,
    cipCosts,
    cipJobReadableIds
  } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const settings = useSettings();
  const taxDepreciationEnabled =
    (settings as any).assetTaxDepreciationEnabled ?? false;
  const { company } = useUser();
  const currencyFormatter = useCurrencyFormatter({
    currency: company.baseCurrencyCode
  });

  if (!fixedAssetId) throw new Error("Could not find fixedAssetId");

  const acquisitionCost = Number(asset.acquisitionCost);
  const accumulatedDepreciation = Number(asset.accumulatedDepreciation);
  const nbv = acquisitionCost - accumulatedDepreciation;
  const depreciationPercent =
    acquisitionCost > 0
      ? Math.min(100, (accumulatedDepreciation / acquisitionCost) * 100)
      : 0;

  const accumulatedTaxDepreciation = Number(
    (asset as any).accumulatedTaxDepreciation ?? 0
  );
  const taxNbv = acquisitionCost - accumulatedTaxDepreciation;
  const taxDepreciationPercent =
    acquisitionCost > 0
      ? Math.min(100, (accumulatedTaxDepreciation / acquisitionCost) * 100)
      : 0;

  const isOutOfService = Boolean(asset.outOfServiceSince);

  return (
    <DocumentPage
      header={<FixedAssetHeader />}
      sidebar={
        <DocumentSidebar
          documents={<FixedAssetDocuments />}
          activity={{
            entityType: "fixedAsset",
            entityId: asset.id,
            refreshKey: `${asset.updatedAt ?? ""}:${asset.status}`
          }}
        />
      }
    >
      {/* Book values, sized by the pane's own width: the tax pair wraps
          under the book three rather than squeezing five figures in a row. */}
      <div className="grid grid-cols-1 gap-4 pt-2 @xl:grid-cols-3">
        <BookValue label={t`Acquisition Cost`}>
          {currencyFormatter.format(acquisitionCost)}
        </BookValue>
        <BookValue label={t`Accum. Depreciation`}>
          {currencyFormatter.format(accumulatedDepreciation)}
        </BookValue>
        <BookValue label={t`Net Book Value`}>
          {currencyFormatter.format(nbv)}
        </BookValue>
        {taxDepreciationEnabled && (
          <>
            <BookValue label={t`Accum. Tax Depr.`}>
              {currencyFormatter.format(accumulatedTaxDepreciation)}
            </BookValue>
            <BookValue label={t`Tax Book Value`}>
              {currencyFormatter.format(taxNbv)}
            </BookValue>
          </>
        )}
      </div>

      <div className="divide-y divide-border border-y border-border">
        <DetailRow label={t`Name`}>{asset.name}</DetailRow>
        <DetailRow label={t`Asset Class`}>
          <Enumerable value={(asset.fixedAssetClass as any)?.name ?? null} />
        </DetailRow>
        <DetailRow label={t`Serial Number`}>
          {asset.serialNumber || "—"}
        </DetailRow>
        <DetailRow label={t`Location`}>
          <Enumerable value={(asset as any).location?.name ?? null} />
        </DetailRow>
        <DetailRow label={t`Work Center`}>
          {workCenterName ? <Enumerable value={workCenterName} /> : "—"}
        </DetailRow>
        {isOutOfService && (
          <DetailRow label={t`Out of Service Since`}>
            <span>
              <DateTime
                value={asset.outOfServiceSince}
                variant="date"
                fallback="—"
              />
              {asset.outOfServiceReason ? ` · ${asset.outOfServiceReason}` : ""}
            </span>
          </DetailRow>
        )}
        <DetailRow label={t`Depreciation Method`}>
          {asset.depreciationMethod}
        </DetailRow>
        <DetailRow label={t`Useful Life`}>
          <Trans>{asset.usefulLifeMonths} months</Trans>
        </DetailRow>
        <DetailRow label={t`Residual Value`}>
          {Number(asset.residualValuePercent)}%
        </DetailRow>
        {taxDepreciationEnabled && (
          <>
            <DetailRow label={t`Tax Depreciation Method`}>
              {(asset as any).taxDepreciationMethod || "—"}
            </DetailRow>
            {(asset as any).taxDepreciationMethod === "MACRS" ? (
              <>
                <DetailRow label={t`MACRS Property Class`}>
                  {(asset as any).macrsPropertyClass ? (
                    <Trans>{(asset as any).macrsPropertyClass}-Year</Trans>
                  ) : (
                    "—"
                  )}
                </DetailRow>
                <DetailRow label={t`MACRS Convention`}>
                  {(asset as any).macrsConvention || "—"}
                </DetailRow>
                <DetailRow label={t`Bonus Depreciation`}>
                  {(asset as any).bonusDepreciationPercent != null
                    ? `${Number((asset as any).bonusDepreciationPercent)}%`
                    : "—"}
                </DetailRow>
              </>
            ) : (
              <>
                <DetailRow label={t`Tax Useful Life`}>
                  {(asset as any).taxUsefulLifeMonths ? (
                    <Trans>{(asset as any).taxUsefulLifeMonths} months</Trans>
                  ) : (
                    "—"
                  )}
                </DetailRow>
                <DetailRow label={t`Tax Residual Value`}>
                  {(asset as any).taxResidualValuePercent != null
                    ? `${Number((asset as any).taxResidualValuePercent)}%`
                    : "—"}
                </DetailRow>
              </>
            )}
          </>
        )}
        <DetailRow label={t`Acquisition Date`}>
          <DateTime value={asset.acquisitionDate} variant="date" fallback="—" />
        </DetailRow>
        <DetailRow label={t`Depreciation Start`}>
          <DateTime
            value={asset.depreciationStartDate}
            variant="date"
            fallback="—"
          />
        </DetailRow>
      </div>

      {/* Depreciation History */}
      {(depreciationHistory.length > 0 || acquisitionCost > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Depreciation</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {acquisitionCost > 0 && (
              <div className="space-y-4">
                <BarProgress
                  progress={depreciationPercent}
                  label={t`Book Depreciation`}
                  value={`${depreciationPercent.toFixed(1)}%`}
                  gradient
                />
                {taxDepreciationEnabled && (
                  <BarProgress
                    progress={taxDepreciationPercent}
                    label={t`Tax Depreciation`}
                    value={`${taxDepreciationPercent.toFixed(1)}%`}
                    gradient
                  />
                )}
              </div>
            )}
            {depreciationHistory.length > 0 && (
              <div className="overflow-x-auto -mx-6 px-6">
                <table className="w-full text-base sm:text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2.5 sm:py-2 font-medium text-muted-foreground">
                        <Trans>Run</Trans>
                      </th>
                      <th className="text-left py-2.5 sm:py-2 font-medium text-muted-foreground">
                        <Trans>Period End</Trans>
                      </th>
                      <th className="text-left py-2.5 sm:py-2 font-medium text-muted-foreground">
                        <Trans>Status</Trans>
                      </th>
                      <th className="text-right py-2.5 sm:py-2 font-medium text-muted-foreground">
                        <Trans>Amount</Trans>
                      </th>
                      {taxDepreciationEnabled && (
                        <th className="text-right py-2.5 sm:py-2 font-medium text-muted-foreground">
                          <Trans>Tax Amount</Trans>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {depreciationHistory.map((item) => {
                      const run = item.depreciationRun as any;
                      return (
                        <tr
                          key={item.id}
                          className="border-b border-border last:border-0"
                        >
                          <td className="py-3 sm:py-2.5 tabular-nums">
                            {run?.id ? (
                              <Link
                                to={path.to.depreciationRun(run.id)}
                                className="text-foreground hover:underline"
                              >
                                {run.depreciationRunId}
                              </Link>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="py-3 sm:py-2.5">
                            <DateTime
                              value={item.periodEnd}
                              variant="date"
                              fallback="—"
                            />
                          </td>
                          <td className="py-3 sm:py-2.5">
                            <DepreciationRunStatus
                              status={run?.status ?? null}
                            />
                          </td>
                          <td className="py-3 sm:py-2.5 text-right tabular-nums">
                            {currencyFormatter.format(Number(item.amount))}
                          </td>
                          {taxDepreciationEnabled && (
                            <td className="py-3 sm:py-2.5 text-right tabular-nums">
                              {currencyFormatter.format(
                                Number((item as any).taxAmount ?? 0)
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Construction in progress cost ledger */}
      {isCipClass && (
        <FixedAssetCipCosts
          costs={cipCosts}
          jobReadableIds={cipJobReadableIds}
        />
      )}

      {/* Transfers */}
      {transfers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Transfers</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto -mx-6 px-6">
              <table className="w-full text-base sm:text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2.5 sm:py-2 font-medium text-muted-foreground">
                      <Trans>Transfer</Trans>
                    </th>
                    <th className="text-left py-2.5 sm:py-2 font-medium text-muted-foreground">
                      <Trans>Type</Trans>
                    </th>
                    <th className="text-left py-2.5 sm:py-2 font-medium text-muted-foreground">
                      <Trans>Source</Trans>
                    </th>
                    <th className="text-left py-2.5 sm:py-2 font-medium text-muted-foreground">
                      <Trans>Date</Trans>
                    </th>
                    <th className="text-left py-2.5 sm:py-2 font-medium text-muted-foreground">
                      <Trans>Journal</Trans>
                    </th>
                    <th className="text-right py-2.5 sm:py-2 font-medium text-muted-foreground">
                      <Trans>Amount</Trans>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {transfers.map((transfer) => (
                    <tr
                      key={transfer.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="py-3 sm:py-2.5 tabular-nums">
                        {transfer.transferId}
                      </td>
                      <td className="py-3 sm:py-2.5">
                        <Enumerable value={transfer.type} />
                      </td>
                      <td className="py-3 sm:py-2.5">
                        <Enumerable value={transfer.sourceType} />
                      </td>
                      <td className="py-3 sm:py-2.5">
                        <DateTime
                          value={transfer.transferDate}
                          variant="date"
                          fallback="—"
                        />
                      </td>
                      <td className="py-3 sm:py-2.5">
                        {transfer.journalId ? (
                          <Link
                            to={path.to.journalEntry(transfer.journalId)}
                            className="text-foreground hover:underline"
                          >
                            <Trans>View</Trans>
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="py-3 sm:py-2.5 text-right tabular-nums">
                        {currencyFormatter.format(Number(transfer.amount))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Notes */}
      <FixedAssetNotes
        key={`notes-${fixedAssetId}`}
        id={fixedAssetId}
        notes={asset.notes as JSONContent}
      />

      {/* Disposal */}
      {disposal && (
        <Card>
          <CardContent className="pt-6">
            <div className="divide-y divide-border">
              <DetailRow label={t`Disposal Method`}>
                {disposal.disposalMethod}
              </DetailRow>
              <DetailRow label={t`Disposal Date`}>
                <DateTime value={disposal.disposalDate} variant="date" />
              </DetailRow>
              <DetailRow label={t`NBV at Disposal`}>
                <span className="tabular-nums">
                  {currencyFormatter.format(
                    Number(disposal.netBookValueAtDisposal)
                  )}
                </span>
              </DetailRow>
              <DetailRow label={t`Sale Proceeds`}>
                <span className="tabular-nums">
                  {currencyFormatter.format(Number(disposal.saleProceeds))}
                </span>
              </DetailRow>
              <DetailRow label={t`Gain/Loss`}>
                <Badge
                  variant={Number(disposal.gainLoss) >= 0 ? "green" : "red"}
                >
                  {currencyFormatter.format(Number(disposal.gainLoss))}
                </Badge>
              </DetailRow>
            </div>
          </CardContent>
        </Card>
      )}

      <Outlet />
    </DocumentPage>
  );
}

/** One book value: a label over a large tabular figure. */
function BookValue({
  label,
  children
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="text-base text-muted-foreground truncate sm:text-sm">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight truncate">
        {children}
      </p>
    </div>
  );
}

function DetailRow({
  label,
  children
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 text-base sm:text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-medium">
        {children}
      </span>
    </div>
  );
}
