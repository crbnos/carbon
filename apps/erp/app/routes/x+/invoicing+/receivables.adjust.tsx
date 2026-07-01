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
import { getArTieOut } from "~/modules/invoicing";
import { path } from "~/utils/path";

// Turns a non-zero AR tie-out variance into a balanced Draft journal entry — the
// receivables control account against the rounding account — then drops the user
// on the journal-entry editor to review and post. The variance is recomputed
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
    getArTieOut(client, companyId, asOfDate),
    getDefaultAccounts(client, companyId)
  ]);

  const variance = Number(tieOut.data?.variance ?? 0);
  const receivablesAccount = defaults.data?.receivablesAccount;
  const offsetAccount = defaults.data?.roundingAccount;

  if (!receivablesAccount || !offsetAccount || variance === 0) {
    throw redirect(
      path.to.receivables,
      await flash(request, error(null, "No receivables variance to adjust"))
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
      path.to.receivables,
      await flash(
        request,
        error(journalEntry.error, "Failed to create adjusting entry")
      )
    );
  }

  const journalId = String(journalEntry.data.id);
  const description = `AR tie-out adjustment as of ${asOfDate}`;

  // Receivables is an asset: subledger > GL (variance > 0) means the asset is
  // understated in the GL — debit receivables to raise it; otherwise credit.
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
        accountId: receivablesAccount,
        description,
        debit: variance > 0 ? variance : 0,
        credit: variance < 0 ? -variance : 0
      },
      {
        accountId: offsetAccount,
        description,
        debit: variance < 0 ? -variance : 0,
        credit: variance > 0 ? variance : 0
      }
    ]
  });

  if (saved.error) {
    // The Draft journal exists; send the user to it to finish by hand rather
    // than reporting a clean success.
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
