// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { isUnaffectedByNavigation } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type {
  LoaderFunctionArgs,
  ShouldRevalidateFunction
} from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import { DocumentPage, DocumentSidebar } from "~/components/DocumentPage";
import {
  getActiveDimensionsWithValues,
  getCompaniesInGroup,
  getJournalEntry,
  getJournalEntryRelatedItems,
  getJournalLineDimensions
} from "~/modules/accounting";
import {
  JournalEntryDocuments,
  JournalEntryHeader
} from "~/modules/accounting/ui/JournalEntries";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Journal Entries`, to: path.to.accountingJournals },
    (data) => data?.journalEntry?.journalEntryId
  ),
  module: "accounting"
};

export const shouldRevalidate: ShouldRevalidateFunction = (args) =>
  isUnaffectedByNavigation(args, { params: ["journalEntryId"] })
    ? false
    : args.defaultShouldRevalidate;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId, companyGroupId } = await requirePermissions(
    request,
    {
      view: "accounting"
    }
  );

  const { journalEntryId } = params;
  if (!journalEntryId) throw new Error("Could not find journalEntryId");

  const [journalEntry, companies, dimensions] = await Promise.all([
    getJournalEntry(client, journalEntryId),
    getCompaniesInGroup(client, companyGroupId),
    getActiveDimensionsWithValues(client, companyGroupId, companyId)
  ]);

  if (journalEntry.error) {
    throw redirect(
      path.to.accountingJournals,
      await flash(
        request,
        error(journalEntry.error, "Failed to load journal entry")
      )
    );
  }

  if (journalEntry.data.companyId !== companyId) {
    throw redirect(path.to.accountingJournals);
  }

  const journalLineIds = (journalEntry.data.journalLine ?? []).map((l) => l.id);
  const lineDimensions = await getJournalLineDimensions(client, journalLineIds);

  return {
    journalEntry: journalEntry.data,
    companies: companies.data ?? [],
    dimensions: dimensions.data ?? [],
    lineDimensions: lineDimensions.data ?? {},
    relatedItems: getJournalEntryRelatedItems(client, companyId, {
      id: journalEntry.data.id,
      sourceType: journalEntry.data.sourceType,
      lines: (journalEntry.data.journalLine ?? []).map((line) => ({
        documentType: line.documentType,
        documentId: line.documentId
      })),
      accountingPeriodId: journalEntry.data.accountingPeriodId,
      reversalOfId: journalEntry.data.reversalOfId,
      reversedById: journalEntry.data.reversedById
    })
  };
}

export default function JournalEntryRoute() {
  const { journalEntry } = useLoaderData<typeof loader>();
  return (
    <DocumentPage
      header={<JournalEntryHeader />}
      sidebar={
        <DocumentSidebar
          documents={<JournalEntryDocuments />}
          activity={{
            entityType: "journalEntry",
            entityId: journalEntry.id,
            refreshKey: `${journalEntry.updatedAt ?? ""}:${journalEntry.status}`
          }}
        />
      }
    >
      <Outlet />
    </DocumentPage>
  );
}
