import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useParams } from "react-router";
import {
  getActiveDimensionsWithValues,
  getCompaniesInGroup,
  getJournalEntry,
  getJournalLineDimensions
} from "~/modules/accounting/accounting.service.server";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Journal Entries",
  to: path.to.accountingJournals
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId, companyGroupId } = await requirePermissions(request, {
    view: "accounting"
  });

  const { journalEntryId } = params;
  if (!journalEntryId) throw new Error("Could not find journalEntryId");

  const [journalEntry, companies, dimensions] = await Promise.all([
    getJournalEntry(journalEntryId),
    getCompaniesInGroup(companyGroupId),
    getActiveDimensionsWithValues(companyGroupId)
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
  const lineDimensions = await getJournalLineDimensions(journalLineIds);

  return {
    journalEntry: journalEntry.data,
    companies: companies.data ?? [],
    dimensions: dimensions.data ?? [],
    lineDimensions: lineDimensions.data ?? {}
  };
}

export default function JournalEntryRoute() {
  const { journalEntryId } = useParams();
  if (!journalEntryId) throw new Error("Could not find journalEntryId");

  return (
    <div className="flex h-[calc(100dvh-49px)] overflow-y-auto scrollbar-hide w-full">
      <div className="h-full p-4 w-full max-w-5xl mx-auto">
        <Outlet />
      </div>
    </div>
  );
}
