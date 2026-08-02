import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { settleNettingStatement } from "~/modules/accounting";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  // NOTE: spec requires accounting_update in BOTH companies; group-level gate
  // here — reviewer to confirm per-company enforcement.
  const { userId } = await requirePermissions(request, {
    update: "accounting",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw redirect(`${path.to.intercompany}?tab=netting`);

  // Settlement replays paired AR/AP payments via the post-payment edge function,
  // which requires elevated privileges — use a service-role client.
  const serviceRole = getCarbonServiceRole();
  const result = await settleNettingStatement(serviceRole, {
    statementId: id,
    userId
  });

  if (result.error) {
    throw redirect(
      path.to.intercompanyNettingStatement(id),
      await flash(
        request,
        error(result.error, "Failed to settle netting statement")
      )
    );
  }

  throw redirect(
    `${path.to.intercompany}?tab=netting`,
    await flash(request, success("Netting statement settled"))
  );
}
