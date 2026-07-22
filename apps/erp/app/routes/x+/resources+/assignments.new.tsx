import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { trigger } from "@carbon/jobs";
import { getLogger } from "@carbon/logger";
import { NotificationEvent } from "@carbon/notifications";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, redirect, useLoaderData, useNavigate } from "react-router";
import {
  getTrainingAssignments,
  getTrainingsList,
  TrainingAssignmentForm,
  trainingAssignmentValidator,
  upsertTrainingAssignment
} from "~/modules/resources";
import type { TrainingListItem } from "~/modules/resources/types";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

const logger = getLogger("erp", "assignments-new");

export const handle: Handle = {
  breadcrumb: msg`New Assignment`,
  to: path.to.newTrainingAssignment
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "resources",
    role: "employee"
  });

  const trainings = await getTrainingsList(client, companyId);

  if (trainings.error) {
    throw redirect(
      path.to.trainingAssignments,
      await flash(request, error(trainings.error, "Error loading trainings"))
    );
  }

  return {
    trainings: (trainings.data ?? []) as TrainingListItem[]
  };
}

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "resources",
    role: "employee"
  });

  const formData = await request.formData();
  const validation = await validator(trainingAssignmentValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { trainingId, groupIds } = validation.data;

  // One assignment per training — duplicates double every employee in the status views
  const existing = await getTrainingAssignments(client, companyId, trainingId);
  if (existing.data && existing.data.length > 0) {
    // 200 on purpose: a 4xx response skips revalidation and the toast never shows
    return data(
      { error: "This training is already assigned" },
      await flash(
        request,
        error(
          null,
          "This training is already assigned. Edit the existing assignment to add more groups or people."
        )
      )
    );
  }

  const result = await upsertTrainingAssignment(client, {
    trainingId,
    groupIds,
    companyId,
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
          error(result.error, "Failed to create assignment")
        )
      }
    );
  }

  // Send notifications to all users in the assigned groups
  if (result.data?.id) {
    try {
      await trigger("notify", {
        companyId,
        documentId: result.data.id,
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
    await flash(request, success("Assignment created successfully"))
  );
}

export default function NewTrainingAssignmentRoute() {
  const { trainings } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: undefined,
    trainingId: "",
    groupIds: [] as string[]
  };

  return (
    <TrainingAssignmentForm
      initialValues={initialValues}
      trainings={trainings}
      onClose={() => navigate(path.to.trainingAssignments)}
    />
  );
}
