import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { getSubsidiary } from "~/modules/settings/settings.service.server";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "settings"
  });

  const { id } = params;
  if (!id) throw notFound("Subsidiary not found");

  const subsidiary = await getSubsidiary(id);
  if (subsidiary.error) {
    throw redirect(
      path.to.companies,
      await flash(request, error(subsidiary.error, "Failed to get subsidiary"))
    );
  }

  return { subsidiary: subsidiary.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "settings"
  });

  const { id } = params;
  if (!id) {
    throw redirect(
      path.to.companies,
      await flash(request, error(params, "Failed to get subsidiary id"))
    );
  }

  const serviceRole = getCarbonServiceRole();
  const { error: deleteError } = await serviceRole
    .from("company")
    .delete()
    .eq("id", id);
  if (deleteError) {
    throw redirect(
      path.to.companies,
      await flash(request, error(deleteError, "Failed to delete subsidiary"))
    );
  }

  throw redirect(
    path.to.companies,
    await flash(request, success("Successfully deleted subsidiary"))
  );
}

export default function DeleteSubsidiaryRoute() {
  const { id } = useParams();
  const { subsidiary } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!id || !subsidiary) return null;

  return (
    <ConfirmDelete
      action={path.to.deleteCompany(id)}
      name={subsidiary.name}
      text={`Are you sure you want to delete ${subsidiary.name}? Any child companies will be promoted to this company's parent level. This cannot be undone.`}
      onCancel={() => navigate(path.to.companies)}
    />
  );
}
