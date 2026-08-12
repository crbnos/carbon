import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { Ability } from "~/modules/resources";
import {
  AbilityForm,
  abilityValidator,
  updateAbility
} from "~/modules/resources";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    update: "resources"
  });

  const { id } = params;
  if (!id) throw notFound("Invalid ability id");

  const formData = await request.formData();
  const validation = await validator(abilityValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { name, recertifyEveryDays } = validation.data;

  const update = await updateAbility(client, id, {
    name,
    recertifyEveryDays: recertifyEveryDays ?? null
  });
  if (update.error) {
    throw redirect(
      path.to.ability(id),
      await flash(request, error(update.error, "Failed to update ability"))
    );
  }

  throw redirect(
    path.to.ability(id),
    await flash(request, success("Updated ability"))
  );
}

export default function AbilityDetailsRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Invalid ability id");

  const navigate = useNavigate();
  const routeData = useRouteData<{ ability: Ability }>(path.to.ability(id));
  const ability = routeData?.ability;

  const onClose = () => navigate(path.to.ability(id));

  const initialValues = {
    id: ability?.id,
    name: ability?.name ?? "",
    recertifyEveryDays: ability?.recertifyEveryDays ?? undefined
  };

  return (
    <AbilityForm
      key={initialValues.id}
      onClose={onClose}
      initialValues={initialValues}
    />
  );
}
