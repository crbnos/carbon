import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { FunctionRegion } from "@supabase/supabase-js";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { path } from "~/utils/path";

const logger = getLogger("erp", "journals-new");

export async function action({ request }: ActionFunctionArgs) {
  const { companyId, userId } = await requirePermissions(request, {
    create: "accounting"
  });

  const serviceRole = getCarbonServiceRole();

  const journalEntry = await serviceRole.functions.invoke<{
    id: string;
  }>("create", {
    body: {
      type: "journalEntry",
      companyId,
      userId
    },
    region: FunctionRegion.UsEast1
  });

  if (!journalEntry.data || journalEntry.error) {
    logger.error(journalEntry.error);
    throw redirect(
      path.to.accountingJournals,
      await flash(
        request,
        error(journalEntry.error, "Failed to create journal entry")
      )
    );
  }

  throw redirect(path.to.journalEntryDetails(String(journalEntry.data.id)));
}
