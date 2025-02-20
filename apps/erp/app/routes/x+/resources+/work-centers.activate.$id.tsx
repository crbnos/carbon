import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ClientActionFunctionArgs } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { activateWorkCenter } from "~/modules/resources";
import { path } from "~/utils/path";
import { getCompanyId, workCentersQuery } from "~/utils/react-query";

export async function action({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "resources",
  });

  const { id } = params;
  if (!id) {
    throw redirect(
      path.to.workCenters,
      await flash(request, error(params, "Failed to get a work center id"))
    );
  }

  const activate = await activateWorkCenter(client, id);
  if (activate.error) {
    throw redirect(
      path.to.workCenters,
      await flash(
        request,
        error(activate.error, "Failed to activate work center")
      )
    );
  }

  throw redirect(
    path.to.workCenters,
    await flash(request, success("Successfully activate work center"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.clientCache?.setQueryData(
    workCentersQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}
