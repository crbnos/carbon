// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs
} from "react-router";
import { data, redirect } from "react-router";
import { deleteProcedure } from "~/modules/production/production.service";
import { path } from "~/utils/path";
import { getCompanyId, proceduresQuery } from "~/utils/react-query";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "production"
  });

  const { id } = params;

  if (!id) throw new Error("id is not found");

  const mutation = await deleteProcedure(client, id);
  if (mutation.error) {
    return data(
      {
        success: false
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
