import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deleteTrainingAssignment } from "~/modules/resources/resources.service.server";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  throw redirect(path.to.trainingAssignments);
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "resources",
    role: "employee"
  });

  const { assignmentId } = params;
  if (!assignmentId) {
    throw redirect(
      path.to.trainingAssignments,
      await flash(request, error(null, "Assignment ID is required"))
    );
  }

  const result = await deleteTrainingAssignment(assignmentId);

  if (result.error) {
    throw redirect(
      path.to.trainingAssignments,
      await flash(request, error(result.error, "Failed to delete assignment"))
    );
  }

  throw redirect(
    path.to.trainingAssignments,
    await flash(request, success("Assignment deleted successfully"))
  );
}
