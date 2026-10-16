// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { getTrainingAssignment } from "~/modules/resources";
import { recordTrainingCompletion } from "~/modules/resources/resources.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "training-assignment-complete");

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "resources",
    role: "employee"
  });

  const formData = await request.formData();
  const trainingAssignmentId = formData.get("trainingAssignmentId");
  const employeeId = formData.get("employeeId");

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

  const assignment = await getTrainingAssignment(
    client,
    trainingAssignmentId.toString()
  );
  if (assignment.error || assignment.data.companyId !== companyId) {
    logger.error("Training assignment not found", {
      companyId,
      trainingAssignmentId: trainingAssignmentId.toString(),
      error: assignment.error
    });
    return data(
      { error: "Training assignment not found" },
      {
        status: 404,
        // @ts-expect-error TS2322 - TODO: fix type
        headers: await flash(
          request,
          error(null, "Training assignment not found")
        )
      }
    );
  }

  // Only the people the assignment targets can complete it: a completion can
  // grant an ability, which gates scheduling.
  const recipients = await client.rpc("users_for_groups", {
    groups: assignment.data.groupIds ?? []
  });
  const recipientIds = (recipients.data ?? []) as string[];
  if (recipients.error || !recipientIds.includes(employeeId.toString())) {
    logger.error("Employee is not assigned this training", {
      companyId,
      trainingAssignmentId: trainingAssignmentId.toString(),
      employeeId: employeeId.toString(),
      error: recipients.error
    });
    return data(
      { error: "This employee is not assigned this training" },
      {
        status: 400,
        // @ts-expect-error TS2322 - TODO: fix type
        headers: await flash(
          request,
          error(null, "This employee is not assigned this training")
        )
      }
    );
  }

  const recorded = await recordTrainingCompletion(client, {
    companyId,
    trainingAssignmentId: trainingAssignmentId.toString(),
    employeeId: employeeId.toString(),
    completedBy: userId,
    assignment: assignment.data,
    certificate: formData.get("certificate")
  });
  if (recorded.error !== null) {
    return data(
      { error: recorded.error },
      {
        status: recorded.status,
        // @ts-expect-error TS2322 - TODO: fix type
        headers: await flash(request, error(null, recorded.error))
      }
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
