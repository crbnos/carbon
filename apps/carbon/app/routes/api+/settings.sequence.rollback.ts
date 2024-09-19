import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { getCurrentSequence, rollbackNextSequence } from "~/modules/settings";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsDelete } from "~/utils/http";
import { error } from "~/utils/result";

export async function action({ request }: ActionFunctionArgs) {
  assertIsDelete(request);
  const { client, companyId } = await requirePermissions(request, {});

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const table = searchParams.get("table") as string;
  const currentSequence = searchParams.get("currentSequence") as string;

  if (
    !table ||
    table === "undefined" ||
    !currentSequence ||
    currentSequence === "undefined"
  )
    return json(
      { data: null },
      await flash(
        request,
        error(request, "Bad request for rolling back sequence")
      )
    );

  const verifyCurrent = await getCurrentSequence(client, table, companyId);
  if (verifyCurrent.error) {
    return json(
      verifyCurrent,
      await flash(
        request,
        error(
          verifyCurrent.error,
          `Failed to get current sequence for ${table}`
        )
      )
    );
  }

  if (verifyCurrent.data !== currentSequence) {
    return json({
      data: null,
      error: "Sequence has changed since last request",
    });
  }

  const rollback = await rollbackNextSequence(client, table, companyId);
  if (rollback.error) {
    return json(
      rollback,
      await flash(
        request,
        error(rollback.error, `Failed to rollback sequence for ${table}`)
      )
    );
  }

  return json({
    data: currentSequence,
    error: null,
  });
}
