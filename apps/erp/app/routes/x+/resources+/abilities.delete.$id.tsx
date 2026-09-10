import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { notifyScheduleInputsChanged } from "~/modules/production";
import { deleteAbility, getAbility } from "~/modules/resources";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "resources"
  });

  const { id } = params;
  if (!id) throw notFound("Invalid ability id");

  const ability = await getAbility(client, id);
  if (ability.error) {
    throw redirect(
      path.to.abilities,
      await flash(request, error(ability.error, "Failed to get ability"))
    );
  }

  return {
    ability: ability.data
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "resources"
  });

  const { id } = params;
  if (!id) {
    throw redirect(
      path.to.abilities,
      await flash(request, error(params, "Failed to get an ability id"))
    );
  }

  // Soft delete — abilities are referenced by requirement tables
  const deactivateAbility = await deleteAbility(client, id, false);
  if (deactivateAbility.error) {
    throw redirect(
      path.to.abilities,
      await flash(
        request,
        error(deactivateAbility.error, "Failed to deactivate ability")
      )
    );
  }

  // Deactivating an ability un-gates any process that required it (the
  // scheduler's process→ability join filters active = true), so the operator
  // pools change — restamp affected jobs and let the wave regenerate.
  await notifyScheduleInputsChanged(
    companyId,
    "ability",
    "Ability deactivated",
    id
  );

  throw redirect(
    path.to.abilities,
    await flash(request, success("Successfully deactivated ability"))
  );
}

export default function DeleteAbilityRoute() {
  const { id } = useParams();
  const { ability } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!ability) return null;
  if (!id) throw new Error("id is not found");

  const onCancel = () => navigate(path.to.abilities);
  const name = ability.name;

  return (
    <ConfirmDelete
      action={path.to.deleteAbility(id)}
      name={name}
      text={t`Are you sure you want to deactivate the ability: ${name}?`}
      onCancel={onCancel}
    />
  );
}
