import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { generateEliminations } from "~/modules/accounting";
import { getParams, path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  // generateEliminationEntries writes to the elimination entity's ledger — a
  // synthetic company the user is not an employee of — so it must run with a
  // service-role client that bypasses RLS. Access is verified here first
  // (create: "accounting"); the RPC re-checks group membership from userId. The
  // RPC stays SECURITY INVOKER so a direct client.rpc call from a normal user
  // runs under their own RLS and cannot post eliminations for a foreign group.
  const { client, companyGroupId, userId } = await requirePermissions(request, {
    create: "accounting",
    bypassRls: true
  });

  const result = await generateEliminations(client, companyGroupId, userId);

  if (result.error) {
    throw redirect(
      `${path.to.intercompany}?${getParams(request)}`,
      await flash(
        request,
        error(result.error, "Failed to generate elimination entries")
      )
    );
  }

  throw redirect(
    `${path.to.intercompany}?${getParams(request)}`,
    await flash(request, success("Elimination entries generated"))
  );
}
