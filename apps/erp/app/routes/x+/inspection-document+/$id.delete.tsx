import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs
} from "react-router";
import { redirect } from "react-router";
import { deleteInspectionDocument } from "~/modules/production";
import { path } from "~/utils/path";
import { invalidateInspectionDocuments } from "~/utils/react-query";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "quality"
  });

  const { id } = params;
  if (!id) throw new Error("Could not find id");

  const result = await deleteInspectionDocument(client, id, companyId);

  if (result.error) {
    throw redirect(
      path.to.inspectionDocuments,
      await flash(
        request,
        error(result.error, "Failed to delete inspection plan")
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
    await flash(request, success("Inspection plan deleted"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  invalidateInspectionDocuments();
  return await serverAction();
}
