import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useNavigate } from "react-router";
import {
  AbilityForm,
  abilityValidator,
  insertAbility
} from "~/modules/resources";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "resources"
  });

  const formData = await request.formData();
  const validation = await validator(abilityValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { name, recertifyEveryDays } = validation.data;

  const createAbility = await insertAbility(client, {
    name,
    recertifyEveryDays: recertifyEveryDays ?? null,
    companyId,
    createdBy: userId
  });
  if (createAbility.error) {
    throw redirect(
      path.to.abilities,
      await flash(
        request,
        error(createAbility.error, "Failed to create ability")
      )
    );
  }

  throw redirect(
    path.to.abilities,
    await flash(request, success("Created ability"))
  );
}

export default function NewAbilityRoute() {
  const navigate = useNavigate();
  const onClose = () => navigate(path.to.abilities);

  const initialValues = {
    name: "",
    recertifyEveryDays: undefined as number | undefined
  };

  return <AbilityForm onClose={onClose} initialValues={initialValues} />;
}
