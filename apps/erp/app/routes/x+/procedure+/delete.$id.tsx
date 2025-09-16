import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ClientActionFunctionArgs } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { deleteProcedure } from "~/modules/production/production.service";
import { path } from "~/utils/path";
import { getCompanyId, proceduresQuery } from "~/utils/react-query";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "production",
  });

  const { id } = params;

  if (!id) throw new Error("id is not found");

  const mutation = await deleteProcedure(client, id);
  if (mutation.error) {
    return json(
      {
        success: false,
      },
      await flash(request, error(mutation.error, "Failed to delete procedure"))
    );
  }

  throw redirect(
    path.to.procedures,
    await flash(request, success("Successfully deleted procedure"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    proceduresQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}
