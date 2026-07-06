import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deleteInspectionDocument } from "~/modules/quality";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "quality"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const result = await deleteInspectionDocument(client, id);

  if (result.error) {
    throw redirect(
      path.to.inspectionDocuments,
      await flash(
        request,
        error(result.error, "Failed to delete inspection document")
      )
    );
  }

  const storagePath = result.data?.storagePath;
  if (storagePath) {
    const serviceRole = await getCarbonServiceRole();
    await serviceRole.storage.from("private").remove([storagePath]);
  }

  throw redirect(
    path.to.inspectionDocuments,
    await flash(request, success("Inspection document deleted"))
  );
}
