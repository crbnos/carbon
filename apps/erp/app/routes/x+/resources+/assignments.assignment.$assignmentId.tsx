// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData, useNavigate, useParams } from "react-router";
import {
  getTrainingAssignment,
  getTrainingsList,
  TrainingAssignmentForm,
  trainingAssignmentValidator,
  upsertTrainingAssignment
} from "~/modules/resources";
import type { TrainingListItem } from "~/modules/resources/types";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "assignments-assignment-assignmentid");

export const handle: Handle = {
  breadcrumb: msg`Edit Assignment`,
  to: path.to.trainingAssignments
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "resources",
    role: "employee"
  });

  const { assignmentId } = params;
  if (!assignmentId) {
    throw redirect(
      path.to.trainingAssignments,
      await flash(request, error(null, "Assignment ID is required"))
    );
  }

  const [assignment, trainings] = await Promise.all([
    getTrainingAssignment(client, assignmentId),
    getTrainingsList(client, companyId)
  ]);

  if (assignment.error || assignment.data.companyId !== companyId) {
    throw redirect(
      path.to.trainingAssignments,
      await flash(request, error(assignment.error, "Error loading assignment"))
    );
  }

  if (trainings.error) {
    throw redirect(
      path.to.trainingAssignments,
      await flash(request, error(trainings.error, "Error loading trainings"))
    );
  }

  return {
    assignment: assignment.data,
    trainings: (trainings.data ?? []) as TrainingListItem[]
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "resources",
    role: "employee"
  });

  const { assignmentId } = params;
  if (!assignmentId) {
    return data({ error: "Assignment ID is required" }, { status: 400 });
  }

  const formData = await request.formData();
  const validation = await validator(trainingAssignmentValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // Internal or external is fixed at creation: read it from the stored
  // assignment, never from the form.
  const stored = await getTrainingAssignment(client, assignmentId);
  if (stored.error || stored.data.companyId !== companyId) {
    logger.error("Training assignment not found", {
      companyId,
      assignmentId,
      error: stored.error
    });
    return data({ error: "Training assignment not found" }, { status: 404 });
  }
  const isExternal = stored.data.trainingId === null;

  const { name, groupIds } = validation.data;

  const result = await upsertTrainingAssignment(client, {
    id: assignmentId,
    name: isExternal ? name : null,
    groupIds,
    companyId,
    updatedBy: userId
  });

  if (result.error) {
    return data(
      { error: result.error.message },
      {
        status: 500,
        // @ts-expect-error TS2322 - TODO: fix type
        headers: await flash(
          request,
          error(result.error, "Failed to update assignment")
        )
      }
    );
  }

  // An external training happens in an outside system, which notifies people.
  if (!isExternal) {
    try {
      await trigger("notify", {
        companyId,
        documentId: assignmentId,
        event: NotificationEvent.TrainingAssignment,
        recipient: {
          type: "group",
          groupIds
        },
        from: userId
      });
    } catch (err) {
      logger.error("Failed to send training assignment notifications", {
        error: err
      });
    }
  }

  throw redirect(
    path.to.trainingAssignments,
    await flash(request, success("Assignment updated successfully"))
  );
}

export default function EditTrainingAssignmentRoute() {
  const { assignment, trainings } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const params = useParams();

  const initialValues = {
    id: params.assignmentId!,
    isExternal: !assignment?.trainingId,
    trainingId: assignment?.trainingId ?? "",
    name: assignment?.name ?? "",
    groupIds: assignment?.groupIds ?? []
  };

  return (
    <TrainingAssignmentForm
      initialValues={initialValues}
      trainings={trainings}
      onClose={() => navigate(path.to.trainingAssignments)}
    />
  );
}
