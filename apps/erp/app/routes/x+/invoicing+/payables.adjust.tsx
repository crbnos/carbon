import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  getDefaultAccounts,
  saveJournalEntryWithLines
} from "~/modules/accounting";
import { getApTieOut } from "~/modules/invoicing";
import { path } from "~/utils/path";

// Turns a non-zero AP tie-out variance into a balanced Draft journal entry — the
// payables control account against the rounding account — then drops the user on
// the journal-entry editor to review and post. The variance is recomputed
// server-side (not trusted from the form) so the seeded lines always match the
// current books.
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, companyGroupId, userId } =
    await requirePermissions(request, { create: "accounting" });

  const formData = await request.formData();
  const asOfDate =
    (formData.get("asOfDate") as string | null) ??
    new Date().toISOString().slice(0, 10);

  const [tieOut, defaults] = await Promise.all([
    getApTieOut(client, companyId, asOfDate),
    getDefaultAccounts(client, companyId)
  ]);

  const variance = Number(tieOut.data?.variance ?? 0);
  const payablesAccount = defaults.data?.payablesAccount;
  const offsetAccount = defaults.data?.roundingAccount;

  if (!payablesAccount || !offsetAccount || variance === 0) {
    throw redirect(
      path.to.payables,
      await flash(request, error(null, "No payables variance to adjust"))
    );
  }

  const serviceRole = getCarbonServiceRole();
  const journalEntry = await serviceRole.functions.invoke<{ id: string }>(
    "create",
    {
      body: { type: "journalEntry", companyId, userId },
      region: FunctionRegion.UsEast1
    }
  );

  if (!journalEntry.data || journalEntry.error) {
    throw redirect(
      path.to.payables,
      await flash(
        request,
        error(journalEntry.error, "Failed to create adjusting entry")
      )
    );
  }

  const journalId = String(journalEntry.data.id);
  const description = `AP tie-out adjustment as of ${asOfDate}`;

  // Payables is a liability: subledger > GL (variance > 0) means the liability
  // is understated in the GL — credit payables to raise it; otherwise debit.
  // The offsetting half lands in the rounding account so the entry is balanced.
  const saved = await saveJournalEntryWithLines(client, {
    journalEntryId: journalId,
    postingDate: asOfDate,
    description,
    updatedBy: userId,
    companyId,
    companyGroupId,
    lines: [
      {
        accountId: payablesAccount,
        description,
        debit: variance < 0 ? -variance : 0,
        credit: variance > 0 ? variance : 0
      },
      {
        accountId: offsetAccount,
        description,
        debit: variance > 0 ? variance : 0,
        credit: variance < 0 ? -variance : 0
      }
    ]
  });

  if (saved.error) {
    throw redirect(
      path.to.journalEntryDetails(journalId),
      await flash(
        request,
        error(saved.error, "Entry created, but seeding the lines failed")
      )
    );
  }

  throw redirect(path.to.journalEntryDetails(journalId));
}
