import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ClientActionFunctionArgs } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  AbilityForm,
  abilityValidator,
  deleteAbility,
  insertAbility,
  insertEmployeeAbilities,
} from "~/modules/resources";
import { path } from "~/utils/path";
import { abilitiesQuery, getCompanyId } from "~/utils/react-query";

function makeCurve(startingPoint: number, weeks: number) {
  return {
    data: [
      {
        week: 0,
        value: startingPoint,
      },
      {
        week: weeks / 4,
        value: (100 - startingPoint) * 0.5 + startingPoint,
      },
      {
        week: weeks / 2,
        value: 100 - (100 - startingPoint) * 0.25,
      },
      {
        week: weeks,
        value: 100,
      },
    ],
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "resources",
  });

  const validation = await validator(abilityValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { name, startingPoint, shadowWeeks, weeks, employees } =
    validation.data;

  const createAbility = await insertAbility(client, {
    name,
    curve: makeCurve(startingPoint, weeks),
    shadowWeeks,
    companyId,
    createdBy: userId,
  });
  if (createAbility.error) {
    return json(
      {},
      await flash(
        request,
        error(createAbility.error, "Failed to insert ability")
      )
    );
  }

  const abilityId = createAbility.data?.id;
  if (!abilityId) {
    return json(
      {},
      await flash(request, error(createAbility, "Failed to insert ability"))
    );
  }

  if (employees) {
    const createEmployeeAbilities = await insertEmployeeAbilities(
      client,
      abilityId,
      employees,
      companyId
    );

    if (createEmployeeAbilities.error) {
      console.error(createEmployeeAbilities.error);
      await deleteAbility(client, abilityId, true);
      return json(
        {},
        await flash(
          request,
          error(
            createEmployeeAbilities.error,
            "Failed to insert ability members"
          )
        )
      );
    }
  }

  throw redirect(
    path.to.abilities,
    await flash(request, success(`Ability created`))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  window.queryClient?.setQueryData(
    abilitiesQuery(getCompanyId()).queryKey,
    null
  );
  return await serverAction();
}

export default function NewAbilityRoute() {
  const initialValues = {
    name: "",
    startingPoint: 85,
    shadowWeeks: 0,
    weeks: 4,
    employees: [],
  };

  return <AbilityForm initialValues={initialValues} />;
}
