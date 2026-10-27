// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  RecordOutlet
} from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { LuTriangleAlert } from "react-icons/lu";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { DateTime, Hyperlink } from "~/components";
import { DocumentPage, DocumentSidebar } from "~/components/DocumentPage";
import { useUser } from "~/hooks";
import { useCurrencyFormatter } from "~/hooks/useCurrencyFormatter";
import {
  getCurrencyRevaluationLines,
  getCurrencyRevaluationRates,
  getCurrencyRevaluationRun,
  getPeriodRunRelatedItems,
  listRevaluationNotRevalued
} from "~/modules/accounting/accounting.service";
import {
  CurrencyRevaluationBalancesGrid,
  CurrencyRevaluationLinesTable,
  CurrencyRevaluationRatesGrid,
  CurrencyRevaluationRunDocuments,
  CurrencyRevaluationRunHeader
} from "~/modules/accounting/ui/CurrencyRevaluation";
import { getDatabaseClient } from "~/services/database.server";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    {
      breadcrumb: msg`Currency Revaluation`,
      to: path.to.currencyRevaluationRuns
    },
    (data) => data?.run?.currencyRevaluationRunId
  ),
  module: "accounting"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "accounting"
  });

  const { runId } = params;
  if (!runId) throw new Error("Could not find runId");

  const [run, lines, rates] = await Promise.all([
    getCurrencyRevaluationRun(client, runId),
    getCurrencyRevaluationLines(client, runId),
    getCurrencyRevaluationRates(client, runId)
  ]);

  if (run.error || lines.error || rates.error) {
    throw redirect(
      path.to.currencyRevaluationRuns,
      await flash(
        request,
        error(
          run.error ?? lines.error ?? rates.error,
          "Failed to load currency revaluation run"
        )
      )
    );
  }

  const notRevalued = await listRevaluationNotRevalued(getDatabaseClient(), {
    companyId,
    periodEnd: run.data.periodEnd
  });

  const journalIds = [run.data.journalId, run.data.reversalJournalId].filter(
    (id): id is string => Boolean(id)
  );

  return {
    run: run.data,
    lines: lines.data ?? [],
    rates: rates.data ?? [],
    notRevalued,
    relatedItems: getPeriodRunRelatedItems(
      client,
      companyId,
      run.data.periodEnd,
      journalIds
    )
  };
}

export default function CurrencyRevaluationRunDetailRoute() {
  const { t } = useLingui();
  const { run, lines, rates, notRevalued } = useLoaderData<typeof loader>();
  const { company } = useUser();
  const currencyFormatter = useCurrencyFormatter({
    currency: company.baseCurrencyCode
  });

  let gains = 0;
  let losses = 0;
  for (const line of lines) {
    const difference = Number(line.differenceAmount);
    if (difference > 0) gains += difference;
    else losses += difference;
  }

  return (
    <DocumentPage
      header={<CurrencyRevaluationRunHeader />}
      sidebar={
        <DocumentSidebar
          documents={<CurrencyRevaluationRunDocuments />}
          activity={{
            entityType: "currencyRevaluationRun",
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
            <Trans>Items</Trans>
          </dt>
          <dd className="text-sm tabular-nums">{lines.length}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-muted-foreground">
            <Trans>Gains</Trans>
          </dt>
          <dd className="text-sm tabular-nums">
            {currencyFormatter.format(gains)}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-muted-foreground">
            <Trans>Losses</Trans>
          </dt>
          <dd className="text-sm tabular-nums">
            {currencyFormatter.format(losses)}
          </dd>
        </div>
      </dl>

      {notRevalued.length > 0 && (
        <Alert variant="warning">
          <LuTriangleAlert className="h-4 w-4" />
          <AlertTitle>
            <Trans>Not revalued</Trans>
          </AlertTitle>
          <AlertDescription>
            <p>
              <Trans>
                This run does not revalue these memos: a settlement against them
                does not record the amount in the memo's currency.
              </Trans>
            </p>
            <ul className="list-disc pl-4">
              {notRevalued.map((document) => (
                <li key={document.documentId}>
                  <Hyperlink to={path.to.memo(document.documentId)}>
                    {document.documentNumber}
                  </Hyperlink>{" "}
                  <span className="text-muted-foreground">
                    {document.documentType === "Debit Memo"
                      ? t`Debit Memo`
                      : t`Credit Memo`}
                  </span>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Exchange Rates</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CurrencyRevaluationRatesGrid run={run} rates={rates} />
        </CardContent>
      </Card>

      {lines.some((line) => line.exposureType === "Account Balance") && (
        <Card>
          <CardHeader>
            <CardTitle>
              <Trans>Statement Balances</Trans>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CurrencyRevaluationBalancesGrid run={run} lines={lines} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Revaluation Lines</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <CurrencyRevaluationLinesTable lines={lines} />
        </CardContent>
      </Card>

      <RecordOutlet />
    </DocumentPage>
  );
}
