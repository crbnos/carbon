import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { requirePlan } from "@carbon/ee/plan.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { useRouteData } from "~/hooks";
import type { ApiKey } from "~/modules/settings";
import { deleteApiKey } from "~/modules/settings";
import { getParams, path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    update: "users"
  });

  await requirePlan({
    request,
    client,
    companyId,
    feature: "API_KEYS",
    redirectTo: path.to.apiKeys
  });

  const { id } = params;
  if (!id) {
    throw redirect(
      path.to.itemPostingGroups,
      await flash(request, error(params, "Failed to get an id"))
    );
  }

  const { error: deleteApiKeyError } = await deleteApiKey(id);
  if (deleteApiKeyError) {
    throw redirect(
      `${path.to.apiKeys}?${getParams(request)}`,
      await flash(request, error(deleteApiKeyError, "Failed to delete API key"))
    );
  }

  throw redirect(
    `${path.to.apiKeys}?${getParams(request)}`,
    await flash(request, success("Successfully deleted API key"))
  );
}

export default function DeleteApiKeyRoute() {
  const { id } = useParams();
  if (!id) throw new Error("Could not find id");
  const routeData = useRouteData<{ apiKeys: ApiKey[] }>(path.to.apiKeys);
  const navigate = useNavigate();
  const { t } = useLingui();

  const apiKey = routeData?.apiKeys.find((apiKey) => apiKey.id === id);
  if (!apiKey) return null;

  const onCancel = () => navigate(-1);

  return (
    <ConfirmDelete
      action={path.to.deleteApiKey(id)}
      name={apiKey.name}
      text={t`Are you sure you want to delete the API key: ${apiKey.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
