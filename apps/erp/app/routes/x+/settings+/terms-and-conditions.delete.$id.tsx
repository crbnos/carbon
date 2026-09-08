import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteTermsVersion, getTermsVersion } from "~/modules/settings";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "settings",
    role: "employee"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const termsVersion = await getTermsVersion(client, id, companyId);
  if (termsVersion.error) {
    throw redirect(
      path.to.termsVersions,
      await flash(
        request,
        error(termsVersion.error, "Failed to load terms version")
      )
    );
  }

  return { termsVersion: termsVersion.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "settings"
  });

  const { id } = params;
  if (!id) throw notFound("id not found");

  const { error: deleteError } = await deleteTermsVersion(
    client,
    id,
    companyId
  );
  if (deleteError) {
    throw redirect(
      `${path.to.termsVersions}?${getParams(request)}`,
      await flash(request, error(deleteError, "Failed to delete terms version"))
    );
  }

  throw redirect(
    `${path.to.termsVersions}?${getParams(request)}`,
    await flash(request, success("Deleted terms version"))
  );
}

export default function DeleteTermsVersionRoute() {
  const { termsVersion } = useLoaderData<typeof loader>();

  const { id } = useParams();
  if (!id) throw new Error("Could not find id");

  const navigate = useNavigate();
  const { t } = useLingui();
  const onCancel = () => navigate(-1);

  return (
    <ConfirmDelete
      action={path.to.deleteTermsVersion(id)}
      name={termsVersion.name}
      text={t`Are you sure you want to delete ${termsVersion.name}? Documents that resolved to this version will fall back to the next matching version. This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
