import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { createInventoryReconciliationJournal } from "~/modules/inventory";
import { getDatabaseClient } from "~/services/database.server";
import { path } from "~/utils/path";

// Tie-out Reconcile action: drafts an adjusting journal that brings the GL
// inventory accounts to the subledger valuation. The journal is Draft — the
// accountant reviews and posts it from the Journals screen.
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const formData = await request.formData();
  const asOfDate =
    (formData.get("asOfDate") as string | null) ||
    new Date().toISOString().slice(0, 10);

  const result = await createInventoryReconciliationJournal(
    client,
    getDatabaseClient(),
    companyId,
    { asOfDate, userId }
  );

  if (result.error) {
    return data(
      {},
      await flash(
        request,
        error(result.error, "Failed to create reconciliation journal")
      )
    );
  }

  throw redirect(
    path.to.accountingJournals,
    await flash(
      request,
      success("Draft reconciliation journal created — review and post it")
    )
  );
}
