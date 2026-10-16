// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { carbon, respond } from "~/modules/carbon.server";
import {
  getTrainingsList,
  TrainingAssignmentForm,
  trainingAssignmentValidator
} from "~/modules/resources";
import type { TrainingListItem } from "~/modules/resources/types";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

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

export async function action(args: ActionFunctionArgs) {
  const input = await validator(trainingAssignmentValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  const result = await api.resources.trainingAssignment.create(input.data);
  // The drawer posts through a fetcher, which toasts a refusal.
  if (result.error) return result;
  return respond(args.request, result).redirect(
    path.to.trainingAssignments,
    "Assignment created successfully"
  );
}

export default function NewTrainingAssignmentRoute() {
  const { trainings } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const initialValues = {
    id: undefined,
    isExternal: false,
    trainingId: "",
    name: "",
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
