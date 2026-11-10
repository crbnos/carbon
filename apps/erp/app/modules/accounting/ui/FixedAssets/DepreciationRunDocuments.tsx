// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

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

type DepreciationRunLine = {
  id: string;
  journalId: string | null;
  fixedAsset: unknown;
};

/**
 * The documents around a depreciation run: the accounting period it posts
 * into and, for a run small enough to list, the journal entry it posted for
 * each asset (posting writes one per asset). The assets themselves are linked
 * from the lines.
 */
const DepreciationRunDocuments = () => {
  const { t } = useLingui();
  const { depreciationRunId } = useParams();
  if (!depreciationRunId) throw new Error("depreciationRunId not found");

  const routeData = useRouteData<{
    lines: DepreciationRunLine[];
    relatedItems?: Promise<PeriodRunRelatedItems>;
  }>(path.to.depreciationRun(depreciationRunId));

  // Each journal names the asset it depreciated.
  const assetByJournalId = new Map<string, string>();
  for (const line of routeData?.lines ?? []) {
    const asset = line.fixedAsset as { fixedAssetId?: string | null } | null;
    if (line.journalId && asset?.fixedAssetId) {
      assetByJournalId.set(line.journalId, asset.fixedAssetId);
    }
  }

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
              {journals.map((journal) => {
                const asset = assetByJournalId.get(journal.id);
                return (
                  <JournalEntryDocument
                    key={journal.id}
                    journal={journal}
                    description={
                      asset ? t`Journal Entry · ${asset}` : t`Journal Entry`
                    }
                  />
                );
              })}
            </RelatedDocumentGroup>
          );
        }}
      </Await>
    </Suspense>
  );
};

export default DepreciationRunDocuments;
