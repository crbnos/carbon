// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { Card, CardContent, CardHeader, CardTitle } from "@carbon/react";
import { isUnaffectedByNavigation } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { DateTime, Hyperlink } from "~/components";
import { DocumentPage, DocumentSidebar } from "~/components/DocumentPage";
import { useSettings, useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import {
  getDepreciationRun,
  getDepreciationRunLines,
  getPeriodRunRelatedItems
} from "~/modules/accounting";
import { depreciationRunLineDisplay } from "~/modules/accounting/accounting.utils";
import {
  DepreciationRunDocuments,
  DepreciationRunHeader
} from "~/modules/accounting/ui/FixedAssets";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

/**
 * Posting writes one journal entry per asset. Up to this many are listed
 * under Documents; past it the list would bury the accounting period, and
 * each asset is still one click away from its line.
 */
const MAX_LISTED_JOURNALS = 10;

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Depreciation`, to: path.to.depreciationRuns },
    (data) => data?.run?.depreciationRunId
  ),
  module: "accounting"
};

export const shouldRevalidate: ShouldRevalidateFunction = (args) =>
  isUnaffectedByNavigation(args, { params: ["depreciationRunId"] })
    ? false
    : args.defaultShouldRevalidate;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });

  const { depreciationRunId } = params;
  if (!depreciationRunId) throw new Error("Could not find depreciationRunId");

  const [run, lines] = await Promise.all([
    getDepreciationRun(client, depreciationRunId),
    getDepreciationRunLines(client, depreciationRunId)
  ]);

  if (run.error) {
    throw redirect(
      path.to.depreciationRuns,
      await flash(request, error(run.error, "Failed to load depreciation run"))
    );
  }

  const journalIds = (lines.data ?? []).flatMap((line) =>
    line.journalId ? [line.journalId] : []
  );

  return {
    run: run.data,
    lines: lines.data ?? [],
    relatedItems: getPeriodRunRelatedItems(
      client,
      companyId,
      run.data.periodEnd,
      journalIds.length <= MAX_LISTED_JOURNALS ? journalIds : []
    )
  };
}

export default function DepreciationRunDetailRoute() {
  const { t } = useLingui();
  const { run, lines } = useLoaderData<typeof loader>();
  const settings = useSettings();
  const taxDepreciationEnabled =
    (settings as any).assetTaxDepreciationEnabled ?? false;
  const { company } = useUser();
  const currencyFormatter = useCurrencyFormatter({
    currency: company.baseCurrencyCode
  });

  const isPosted = run.status === "Posted";
  const totalAmount = lines.reduce((sum, line) => sum + Number(line.amount), 0);
  const totalTaxAmount = taxDepreciationEnabled
    ? lines.reduce((sum, line) => sum + Number((line as any).taxAmount ?? 0), 0)
    : 0;
  const assetCount = lines.length;

  const gridCols = taxDepreciationEnabled
    ? "grid-cols-[auto_1fr_1fr_120px_120px_120px_120px_120px]"
    : "grid-cols-[auto_1fr_1fr_120px_120px_120px_120px]";
  // The columns are fixed-width money; below this the table scrolls sideways
  // instead of crushing the asset names.
  const minTableWidth = taxDepreciationEnabled
    ? "min-w-[880px]"
    : "min-w-[760px]";

  return (
    <DocumentPage
      header={<DepreciationRunHeader />}
      sidebar={
        <DocumentSidebar
          documents={<DepreciationRunDocuments />}
          activity={{
            entityType: "depreciationRun",
            entityId: run.id,
            refreshKey: `${run.postedAt ?? ""}:${run.status}`
          }}
        />
      }
    >
      <dl className="grid grid-cols-2 @min-[42rem]:grid-cols-4 gap-x-8 gap-y-4 w-full pt-2 pb-4">
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-muted-foreground">
            <Trans>Period End</Trans>
          </dt>
          <dd className="text-sm">
            <DateTime value={run.periodEnd} variant="date" />
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-muted-foreground">
            <Trans>Assets</Trans>
          </dt>
          <dd className="text-sm tabular-nums">{assetCount}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-muted-foreground">
            <Trans>Depreciation</Trans>
          </dt>
          <dd className="text-sm tabular-nums">
            {currencyFormatter.format(totalAmount)}
          </dd>
        </div>
        {taxDepreciationEnabled && (
          <div className="flex flex-col gap-1">
            <dt className="text-sm text-muted-foreground">
              <Trans>Tax Depreciation</Trans>
            </dt>
            <dd className="text-sm tabular-nums">
              {currencyFormatter.format(totalTaxAmount)}
            </dd>
          </div>
        )}
      </dl>

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Depreciation Lines</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-border overflow-x-auto w-full">
            <div className={minTableWidth}>
              {/* Column Headers */}
              <div
                className={`grid ${gridCols} items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground font-medium bg-muted/50 border-b border-border`}
              >
                <div className="w-6" />
                <div>
                  <Trans>Asset</Trans>
                </div>
                <div>
                  <Trans>Name</Trans>
                </div>
                <div className="text-right">
                  <Trans>Cost</Trans>
                </div>
                <div className="text-right">
                  <Trans>Accum. Depr.</Trans>
                </div>
                <div className="text-right">
                  <Trans>Amount</Trans>
                </div>
                {taxDepreciationEnabled && (
                  <div className="text-right">
                    <Trans>Tax Amount</Trans>
                  </div>
                )}
                <div className="text-right">
                  <Trans>NBV After</Trans>
                </div>
              </div>

              {/* Lines */}
              <div className="divide-y divide-border">
                {lines.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-muted-foreground text-center">
                    <Trans>No assets to depreciate for this period.</Trans>
                  </div>
                ) : (
                  lines.map((line, index) => {
                    const asset = line.fixedAsset as any;
                    const cost = Number(asset?.acquisitionCost ?? 0);
                    const amount = Number(line.amount);
                    const {
                      accumulatedDepreciationBefore: accDepr,
                      netBookValueAfter: nbvAfter
                    } = depreciationRunLineDisplay({
                      acquisitionCost: cost,
                      accumulatedDepreciation: Number(
                        asset?.accumulatedDepreciation ?? 0
                      ),
                      amount,
                      isPosted
                    });
                    return (
                      <div
                        key={line.id}
                        className={`grid ${gridCols} items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/30 transition-colors`}
                      >
                        <div className="w-6 text-muted-foreground tabular-nums">
                          {index + 1}
                        </div>
                        <div className="min-w-0 truncate">
                          {asset?.id ? (
                            <Hyperlink to={path.to.fixedAsset(asset.id)}>
                              {asset.fixedAssetId ?? "—"}
                            </Hyperlink>
                          ) : (
                            "—"
                          )}
                        </div>
                        <div className="min-w-0 truncate text-muted-foreground">
                          {asset?.name ?? "—"}
                        </div>
                        <div className="text-right tabular-nums">
                          {currencyFormatter.format(cost)}
                        </div>
                        <div className="text-right tabular-nums">
                          {currencyFormatter.format(accDepr)}
                        </div>
                        <div className="text-right tabular-nums font-medium">
                          {currencyFormatter.format(amount)}
                        </div>
                        {taxDepreciationEnabled && (
                          <div className="text-right tabular-nums font-medium">
                            {currencyFormatter.format(
                              Number((line as any).taxAmount ?? 0)
                            )}
                          </div>
                        )}
                        <div className="text-right tabular-nums">
                          {currencyFormatter.format(nbvAfter)}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Totals */}
              {lines.length > 0 && (
                <div
                  className={`grid ${gridCols} items-center gap-3 px-4 py-3 bg-muted/50 border-t border-border`}
                >
                  <div className="w-6" />
                  <div className="text-sm font-medium">
                    {assetCount === 1 ? t`1 Asset` : t`${assetCount} Assets`}
                  </div>
                  <div />
                  <div />
                  <div />
                  <div className="text-right font-mono text-sm tabular-nums font-medium">
                    {currencyFormatter.format(totalAmount)}
                  </div>
                  {taxDepreciationEnabled && (
                    <div className="text-right font-mono text-sm tabular-nums font-medium">
                      {currencyFormatter.format(totalTaxAmount)}
                    </div>
                  )}
                  <div />
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Outlet />
    </DocumentPage>
  );
}
