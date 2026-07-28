import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteJobOperationStepSlide } from "~/modules/production";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "production"
  });

  const { id } = params;
  if (!id) {
    throw new Error("id not found");
  }

  const deleteSlide = await deleteJobOperationStepSlide(client, id);
  if (deleteSlide.error) {
    return data(
      { id: null },
      await flash(
        request,
        error(deleteSlide.error, "Failed to delete job operation step slide")
      )
    );
  }

  return {};
}
