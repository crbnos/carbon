import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useLoaderData,
  useNavigate,
  useParams
} from "react-router";
import {
  getTrainingAssignment,
  getTrainingAssignmentStatus,
  getTrainingsList,
  TrainingAssignmentForm,
  trainingAssignmentValidator,
  upsertTrainingAssignment
} from "~/modules/resources";
import type {
  TrainingAssignmentStatusItem,
  TrainingListItem
} from "~/modules/resources/types";
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

  const [assignment, trainings, assignmentStatus] = await Promise.all([
    getTrainingAssignment(client, assignmentId),
    getTrainingsList(client, companyId),
    // @ts-expect-error TS2345 - TODO: fix type
    getTrainingAssignmentStatus(client, companyId, {
      // We'll filter by trainingId which we'll get from the assignment
    })
  ]);

  if (assignment.error) {
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

  // Filter assignment status by trainingAssignmentId
  const filteredStatus = (assignmentStatus.data ?? []).filter(
    (s) => s.trainingAssignmentId === assignmentId
  );

  const currentPeriod =
    filteredStatus.length > 0 ? filteredStatus[0].currentPeriod : null;

  return {
    assignment: assignment.data,
    trainings: (trainings.data ?? []) as TrainingListItem[],
    assignmentStatus: filteredStatus as TrainingAssignmentStatusItem[],
    currentPeriod
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

  const { trainingId, groupIds } = validation.data;

  const result = await upsertTrainingAssignment(client, {
    id: assignmentId,
    trainingId,
    groupIds,
    companyId: "", // not used for updates
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

  // Send notifications to all users in the assigned groups
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

  throw redirect(
    path.to.trainingAssignments,
    await flash(request, success("Assignment updated successfully"))
  );
}

export default function EditTrainingAssignmentRoute() {
  const { assignment, trainings, assignmentStatus, currentPeriod } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const params = useParams();

  const initialValues = {
    id: params.assignmentId!,
    trainingId: assignment?.trainingId ?? "",
    groupIds: assignment?.groupIds ?? []
  };

  return (
    <TrainingAssignmentForm
      initialValues={initialValues}
      trainings={trainings}
      assignmentStatus={assignmentStatus}
      currentPeriod={currentPeriod}
      onClose={() => navigate(path.to.trainingAssignments)}
    />
  );
}
