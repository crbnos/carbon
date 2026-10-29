// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import type { Database } from "@carbon/database";
import { useLingui } from "@lingui/react/macro";
import { Suspense } from "react";
import { Await, useParams } from "react-router";
import { Empty } from "~/components";
import {
  RelatedDocumentGroup,
  RelatedDocumentSkeleton
} from "~/components/DocumentPage";
import { useRouteData } from "~/hooks";
import { path } from "~/utils/path";
import {
  AccountingPeriodDocument,
  JournalEntryDocument,
  type PeriodRunRelatedItems
} from "../PeriodRunDocuments";

type CurrencyRevaluationRun =
  Database["public"]["Tables"]["currencyRevaluationRun"]["Row"];

/**
 * The documents around a currency revaluation run: the accounting period it
 * posts into and, once posted, its valuation journal and the next-day
 * reversal.
 */
const CurrencyRevaluationRunDocuments = () => {
  const { t } = useLingui();
  const { runId } = useParams();
  if (!runId) throw new Error("runId not found");

  const routeData = useRouteData<{
    run: CurrencyRevaluationRun;
    relatedItems?: Promise<PeriodRunRelatedItems>;
  }>(path.to.currencyRevaluationRun(runId));

  const run = routeData?.run;

  return (
    <Suspense
      fallback={
        <RelatedDocumentGroup>
          <RelatedDocumentSkeleton />
          <RelatedDocumentSkeleton />
        </RelatedDocumentGroup>
      }
    >
      <Await resolve={routeData?.relatedItems}>
        {(resolved) => {
          const period = resolved?.accountingPeriod ?? null;
          const journals = [...(resolved?.journals ?? [])].sort((a, b) =>
            a.journalEntryId.localeCompare(b.journalEntryId)
          );

          if (!period && journals.length === 0) {
            return <Empty className="py-12" />;
          }

          return (
            <RelatedDocumentGroup>
              {period && <AccountingPeriodDocument period={period} />}
              {journals.map((journal) => (
                <JournalEntryDocument
                  key={journal.id}
                  journal={journal}
                  description={
                    journal.id === run?.journalId
                      ? t`Journal Entry · Valuation`
                      : journal.id === run?.reversalJournalId
                        ? t`Journal Entry · Reversal`
                        : t`Journal Entry`
                  }
                />
              ))}
            </RelatedDocumentGroup>
          );
        }}
      </Await>
    </Suspense>
  );
};

export default CurrencyRevaluationRunDocuments;
