import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { notifyScheduleInputsChanged } from "~/modules/production";
import {
  getTrainingGrantedAbilityId,
  insertTrainingCompletion
} from "~/modules/resources";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "resources",
    role: "employee"
  });

  const formData = await request.formData();
  const trainingAssignmentId = formData.get("trainingAssignmentId");
  const employeeId = formData.get("employeeId");
  const period = formData.get("period");

  if (!trainingAssignmentId || !employeeId) {
    return data(
      { error: "Missing required fields" },
      {
        status: 400,
        // @ts-expect-error TS2322 - TODO: fix type
        headers: await flash(request, error(null, "Missing required fields"))
      }
    );
  }

  const result = await insertTrainingCompletion(client, {
    trainingAssignmentId: trainingAssignmentId.toString(),
    employeeId: employeeId.toString(),
    period: period?.toString() || null,
    companyId,
    completedBy: userId,
    createdBy: userId
  });

  if (result.error) {
    return data(
      { error: result.error.message },
      {
        status: 500,
        // @ts-expect-error TS2322 - TODO: fix type
        headers: await flash(
          request,
          error(result.error, "Failed to mark training complete")
        )
      }
    );
  }

  // Completing training that grants an ability adds a qualification (via the
  // grant trigger) — restamp the scheduler for that ability's operator pool.
  const grantedAbilityId = await getTrainingGrantedAbilityId(
    client,
    trainingAssignmentId.toString(),
    companyId
  );
  if (grantedAbilityId) {
    await notifyScheduleInputsChanged(
      companyId,
      "ability",
      "Operator qualified via training",
      grantedAbilityId
    );
  }

  return data(
    { success: true },
    {
      // @ts-expect-error TS2322 - TODO: fix type
      headers: await flash(request, success("Training marked as complete"))
    }
  );
}

export async function loader() {
  return redirect(path.to.trainingAssignments);
}
