import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deleteJournalEntry } from "~/modules/accounting/accounting.service.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "accounting"
  });

  const { journalEntryId } = params;
  if (!journalEntryId) throw new Error("Could not find journalEntryId");

  const result = await deleteJournalEntry(journalEntryId);

  if (result.error) {
    throw redirect(
      path.to.journalEntryDetails(journalEntryId),
      await flash(
        request,
        error(result.error, "Failed to delete journal entry")
      )
    );
  }

  throw redirect(
    path.to.accountingJournals,
    await flash(request, success("Journal entry deleted"))
  );
}
