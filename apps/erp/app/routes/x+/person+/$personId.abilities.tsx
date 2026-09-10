import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { VStack } from "@carbon/react";
import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useParams } from "react-router";
import { PersonAbilities, PersonTrainings } from "~/modules/people/ui/Person";
import {
  getEmployeeAbilities,
  getTrainingAssignmentStatusForEmployee
} from "~/modules/resources";
import type { TrainingAssignmentStatusItem } from "~/modules/resources/types";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "people"
  });

  const { personId } = params;
  if (!personId) throw new Error("Could not find personId");

  const [employeeAbilities, trainings] = await Promise.all([
    getEmployeeAbilities(client, personId, companyId),
    getTrainingAssignmentStatusForEmployee(client, companyId, personId)
  ]);

  if (employeeAbilities.error) {
    throw redirect(
      path.to.people,
      await flash(
        request,
        error(employeeAbilities.error, "Failed to load abilities")
      )
    );
  }

  return {
    abilities: employeeAbilities.data ?? [],
    trainings: (trainings.data ?? []) as TrainingAssignmentStatusItem[]
  };
}

export default function PersonAbilitiesRoute() {
  const { abilities, trainings } = useLoaderData<typeof loader>();
  const { personId } = useParams();
  if (!personId) throw new Error("Could not find personId");

  return (
    <VStack spacing={4}>
      <PersonAbilities personId={personId} abilities={abilities} />
      <PersonTrainings trainings={trainings} />
    </VStack>
  );
}
