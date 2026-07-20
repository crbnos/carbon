import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { postJournalEntry } from "~/modules/accounting";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const { journalEntryId } = params;
  if (!journalEntryId) throw new Error("Could not find journalEntryId");

  const result = await postJournalEntry(
    client,
    getDatabaseClient(),
    journalEntryId,
    userId
  );

  if (result.error) {
    throw redirect(
      path.to.journalEntryDetails(journalEntryId),
      await flash(request, error(result.error, "Failed to post journal entry"))
    );
  }

  throw redirect(
    path.to.journalEntryDetails(journalEntryId),
    await flash(request, success("Journal entry posted"))
  );
}
