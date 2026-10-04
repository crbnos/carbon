// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  HStack
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData } from "react-router";
import { DateTime, Hyperlink } from "~/components";
import { DocumentPage, DocumentSidebar } from "~/components/DocumentPage";
import { useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import {
  getPeriodRunRelatedItems,
  getRevenueRecognitionRun,
  getRevenueRecognitionRunLines,
  revenueScheduleTypes
} from "~/modules/accounting";
import { getCompanyToday } from "~/modules/accounting/accounting.server";
import {
  getNextPeriodEnd,
  isFutureRunPeriod
} from "~/modules/accounting/accounting.utils";
import {
  RevenueRecognitionRunDocuments,
  RevenueRecognitionRunHeader,
  type RunRentalAgreement,
  type RunSalesInvoice
} from "~/modules/accounting/ui/RevenueRecognition";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    {
      breadcrumb: msg`Revenue Recognition`,
      to: path.to.revenueRecognitionRuns
    },
    (data) => data?.run?.runId
  ),
  module: "accounting"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });

  const { runId } = params;
  if (!runId) throw new Error("Could not find runId");

  const [run, lines, companyToday] = await Promise.all([
    getRevenueRecognitionRun(client, runId),
    getRevenueRecognitionRunLines(client, runId),
    getCompanyToday(client, companyId)
  ]);

  if (run.error) {
    throw redirect(
      path.to.revenueRecognitionRuns,
      await flash(
        request,
        error(run.error, "Failed to load revenue recognition run")
      )
    );
  }

  // Name the document behind each row: the invoice for a Deferral, the rental
  // agreement for an Accrual or Interest row (one lookup per source table).
  const scheduleLines = (lines.data ?? []).map((line) => line.schedule);
  const invoiceLineIds = [
    ...new Set(
      scheduleLines
        .map((schedule) => schedule?.salesInvoiceLineId)
        .filter((id): id is string => Boolean(id))
    )
  ];
  const rentalLineIds = [
    ...new Set(
      scheduleLines
        .map((schedule) => schedule?.rentalAgreementLineId)
        .filter((id): id is string => Boolean(id))
    )
  ];

  const [invoiceLines, rentalLines] = await Promise.all([
    invoiceLineIds.length > 0
      ? client
          .from("salesInvoiceLine")
          .select(
            "id, salesInvoice!salesInvoiceLine_invoiceId_fkey(id, invoiceId, status)"
          )
          .eq("companyId", companyId)
          .in("id", invoiceLineIds)
      : null,
    rentalLineIds.length > 0
      ? client
          .from("rentalAgreementLine")
          .select("id, rentalAgreement(id, rentalAgreementId, status)")
          .eq("companyId", companyId)
          .in("id", rentalLineIds)
      : null
  ]);

  // Keyed by the schedule's source line id; invoice and rental line ids never
  // collide (different id prefixes).
  const sources: Record<string, { label: string; to: string }> = {};
  // The same documents once each, for the Documents panel.
  const salesInvoices = new Map<string, RunSalesInvoice>();
  const rentalAgreements = new Map<string, RunRentalAgreement>();
  for (const row of invoiceLines?.data ?? []) {
    if (row.salesInvoice) {
      sources[row.id] = {
        label: row.salesInvoice.invoiceId,
        to: path.to.salesInvoice(row.salesInvoice.id)
      };
      salesInvoices.set(row.salesInvoice.id, row.salesInvoice);
    }
  }
  for (const row of rentalLines?.data ?? []) {
    if (row.rentalAgreement) {
      sources[row.id] = {
        label: row.rentalAgreement.rentalAgreementId,
        to: path.to.rentalAgreement(row.rentalAgreement.id)
      };
      rentalAgreements.set(row.rentalAgreement.id, row.rentalAgreement);
    }
  }

  return {
    run: run.data,
    lines: lines.data ?? [],
    sources,
    salesInvoices: [...salesInvoices.values()],
    rentalAgreements: [...rentalAgreements.values()],
    nextPeriodEnd: getNextPeriodEnd(run.data.periodEnd),
    // Repeat creates the NEXT period's run, which must not be a future month.
    canRepeat: !isFutureRunPeriod(
      getNextPeriodEnd(run.data.periodEnd),
      companyToday
    ),
    relatedItems: getPeriodRunRelatedItems(
      client,
      companyId,
      run.data.periodEnd,
      run.data.journalId ? [run.data.journalId] : []
    )
  };
}

type RevenueScheduleType = (typeof revenueScheduleTypes)[number];

const gridCols = "grid-cols-[auto_1fr_140px_1fr_140px]";

export default function RevenueRecognitionRunDetailRoute() {
  const { run, lines, sources } = useLoaderData<typeof loader>();
  const { t } = useLingui();
  const { company } = useUser();
  const currencyFormatter = useCurrencyFormatter({
    currency: company.baseCurrencyCode
  });

  const sectionLabels: Record<RevenueScheduleType, string> = {
    Deferral: t`Deferrals`,
    Accrual: t`Accruals`,
    Interest: t`Interest`
  };

  const sections = revenueScheduleTypes
    .map((type) => ({
      type,
      lines: lines.filter((line) => line.schedule?.type === type)
    }))
    .filter((section) => section.lines.length > 0);

  const totalAmount = lines.reduce((sum, line) => sum + Number(line.amount), 0);
  const lineCount = lines.length;

  return (
    <DocumentPage
      header={<RevenueRecognitionRunHeader />}
      sidebar={
        <DocumentSidebar
          documents={<RevenueRecognitionRunDocuments />}
          activity={{
            entityType: "revenueRecognitionRun",
            entityId: run.id,
            refreshKey: `${run.updatedAt ?? ""}:${run.status}`
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
            <Trans>Lines</Trans>
          </dt>
          <dd className="text-sm tabular-nums">{lineCount}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-muted-foreground">
            <Trans>Amount</Trans>
          </dt>
          <dd className="text-sm tabular-nums">
            {currencyFormatter.format(totalAmount)}
          </dd>
        </div>
      </dl>

      {sections.length === 0 ? (
        <Card>
          <CardContent>
            <div className="px-4 py-6 text-sm text-muted-foreground text-center w-full">
              <Trans>No revenue to recognize for this period.</Trans>
            </div>
          </CardContent>
        </Card>
      ) : (
        sections.map((section) => {
          const sectionTotal = section.lines.reduce(
            (sum, line) => sum + Number(line.amount),
            0
          );
          const sectionLineCount = section.lines.length;
          return (
            <Card key={section.type}>
              <CardHeader>
                <CardTitle>{sectionLabels[section.type]}</CardTitle>
              </CardHeader>
              <CardContent>
                {/* Two dates, a source and an amount: below this the table
                    scrolls sideways instead of wrapping the period. */}
                <div className="rounded-lg border border-border overflow-x-auto w-full">
                  <div className="min-w-[680px]">
                    {/* Column Headers */}
                    <div
                      className={`grid ${gridCols} items-center gap-3 px-4 py-2.5 text-sm text-muted-foreground font-medium bg-muted/50 border-b border-border`}
                    >
                      <div className="w-6" />
                      <div>
                        <Trans>Period</Trans>
                      </div>
                      <div>
                        <Trans>Scheduled</Trans>
                      </div>
                      <div>
                        <Trans>Source</Trans>
                      </div>
                      <div className="text-right">
                        <Trans>Amount</Trans>
                      </div>
                    </div>

                    {/* Lines */}
                    <div className="divide-y divide-border">
                      {section.lines.map((line, index) => {
                        const sourceLineId =
                          line.schedule?.salesInvoiceLineId ??
                          line.schedule?.rentalAgreementLineId;
                        const source = sourceLineId
                          ? sources[sourceLineId]
                          : undefined;
                        return (
                          <div
                            key={line.id}
                            className={`grid ${gridCols} items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted/30 transition-colors`}
                          >
                            <div className="w-6 text-muted-foreground tabular-nums">
                              {index + 1}
                            </div>
                            <HStack spacing={1}>
                              <DateTime
                                value={line.schedule?.periodStart}
                                variant="date"
                              />
                              <span className="text-muted-foreground">→</span>
                              <DateTime
                                value={line.schedule?.periodEnd}
                                variant="date"
                              />
                            </HStack>
                            <div>
                              <DateTime
                                value={line.schedule?.scheduledDate}
                                variant="date"
                              />
                            </div>
                            <div className="min-w-0 truncate">
                              {source ? (
                                <Hyperlink to={source.to}>
                                  {source.label}
                                </Hyperlink>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </div>
                            <div className="text-right tabular-nums font-medium">
                              {currencyFormatter.format(Number(line.amount))}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Totals */}
                    <div
                      className={`grid ${gridCols} items-center gap-3 px-4 py-3 bg-muted/50 border-t border-border`}
                    >
                      <div className="w-6" />
                      <div className="text-sm font-medium">
                        {sectionLineCount === 1
                          ? t`1 line`
                          : t`${sectionLineCount} lines`}
                      </div>
                      <div />
                      <div />
                      <div className="text-right font-mono text-sm tabular-nums font-medium">
                        {currencyFormatter.format(sectionTotal)}
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}

      <Outlet />
    </DocumentPage>
  );
}
