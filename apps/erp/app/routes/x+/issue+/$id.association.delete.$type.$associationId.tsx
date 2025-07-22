import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect, type ActionFunctionArgs } from "@vercel/remix";
import {
  deleteIssueAssociation,
  nonConformanceAssociationType,
} from "~/modules/quality";
import { path, requestReferrer } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "quality",
  });

  const { id, type, associationId } = params;
  if (!id) throw new Error("Could not find id");
  if (!type) throw new Error("Could not find type");
  if (!associationId) throw new Error("Could not find associationId");

  // @ts-expect-error
  if (!nonConformanceAssociationType.includes(type)) {
    throw new Error(`Invalid type: ${type}`);
  }

  const deletion = await deleteIssueAssociation(client, type, associationId);

  if (deletion.error) {
    throw redirect(
      requestReferrer(request) ?? path.to.issue(id),
      await flash(
        request,
        error(deletion.error, "Failed to delete association")
      )
    );
  }

  throw redirect(
    requestReferrer(request) ?? path.to.issue(id),
    await flash(request, success("Successfully deleted association"))
  );
}
