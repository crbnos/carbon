import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect, type ActionFunctionArgs } from "@vercel/remix";
import { deleteProductionQuantity } from "~/modules/production";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "production",
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const deletion = await deleteProductionQuantity(client, id);
  if (deletion.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.jobs,
      await flash(request, error(deletion.error, "Failed to delete quantity"))
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.jobs,
    await flash(request, success("Successfully deleted quantity"))
  );
}
