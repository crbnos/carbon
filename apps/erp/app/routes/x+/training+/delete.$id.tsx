import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { deleteTraining } from "~/modules/resources/resources.service.server";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "resources"
  });

  const { id } = params;

  if (!id) throw new Error("id is not found");

  const mutation = await deleteTraining(id);
  if (mutation.error) {
    return data(
      {
        success: false
      },
      await flash(request, error(mutation.error, "Failed to delete training"))
    );
  }

  throw redirect(
    path.to.trainings,
    await flash(request, success("Successfully deleted training"))
  );
}
