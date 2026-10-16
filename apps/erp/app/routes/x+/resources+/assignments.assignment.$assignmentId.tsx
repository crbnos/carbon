// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { trainingAssignmentValidator } from "~/modules/resources/resources.models";
import {
  getTrainingAssignment,
  getTrainingsList
} from "~/modules/resources/resources.service";
import type { TrainingListItem } from "~/modules/resources/types";
import { TrainingAssignmentForm } from "~/modules/resources/ui";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

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

export async function action(args: ActionFunctionArgs) {
  const input = await validator(trainingAssignmentValidator).request(args, {
    params: ["assignmentId"]
  });
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.resources.updateTrainingAssignment({
    ...input.data,
    id: input.params.assignmentId
  });
  // The drawer posts through a fetcher, which toasts a refusal.
  if (result.error) return result;
  return respond(args.request, result).redirect(path.to.trainingAssignments, {
    message: "Assignment updated successfully"
  });
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
