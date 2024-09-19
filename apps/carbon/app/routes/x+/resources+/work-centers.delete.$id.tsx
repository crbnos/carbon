import type { LoaderFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { deleteWorkCenter } from "~/modules/resources";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

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

  const deactivateWorkCenter = await deleteWorkCenter(client, id);
  if (deactivateWorkCenter.error) {
    throw redirect(
      path.to.workCenters,
      await flash(
        request,
        error(deactivateWorkCenter.error, "Failed to deactivate work center")
      )
    );
  }

  throw redirect(
    path.to.workCenters,
    await flash(request, success("Successfully deactivated work center"))
  );
}
