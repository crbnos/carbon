import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { reverseJournalEntry } from "~/modules/accounting";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const { journalEntryId } = params;
  if (!journalEntryId) throw new Error("Could not find journalEntryId");

  const result = await reverseJournalEntry(client, journalEntryId, {
    companyId,
    userId
  });

  if (result.error) {
    throw redirect(
      path.to.journalEntryDetails(journalEntryId),
      await flash(
        request,
        error(result.error, "Failed to reverse journal entry")
      )
    );
  }

  throw redirect(
    path.to.journalEntryDetails(journalEntryId),
    await flash(request, success("Journal entry reversed"))
  );
}
