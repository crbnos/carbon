import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ConfirmDelete } from "~/components/Modals";
import { deleteAbility, getAbility } from "~/modules/resources";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { notFound } from "~/utils/http";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "resources",
    role: "employee",
  });

  const { abilityId } = params;
  if (!abilityId) throw notFound("abilityId not found");

  const ability = await getAbility(client, abilityId);
  if (ability.error) {
    throw redirect(
      path.to.abilities,
      await flash(request, error(ability.error, "Failed to get ability"))
    );
  }

  return json({
    ability: ability.data,
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "resources",
  });

  const { abilityId } = params;
  if (!abilityId) {
    throw redirect(
      path.to.abilities,
      await flash(request, error(params, "Failed to get ability id"))
    );
  }

  const { error: deleteAbilityError } = await deleteAbility(client, abilityId);
  if (deleteAbilityError) {
    throw redirect(
      path.to.abilities,
      await flash(
        request,
        error(deleteAbilityError, "Failed to delete ability")
      )
    );
  }

  throw redirect(
    path.to.abilities,
    await flash(request, success("Successfully deleted employee type"))
  );
}

export default function DeleteEmployeeTypeRoute() {
  const { abilityId } = useParams();
  const { ability } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!ability) return null;
  if (!abilityId) throw notFound("abilityId not found");

  const onCancel = () => navigate(path.to.abilities);

  return (
    <ConfirmDelete
      action={path.to.deleteAbility(abilityId)}
      name={ability.name}
      text={`Are you sure you want to delete the ability: ${ability.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
