import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import {
  deleteChangeNoticeRequiredAction,
  getChangeNoticeRequiredAction
} from "~/modules/items";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "parts",
    role: "employee"
  });
  const { id } = params;
  if (!id) throw notFound("id not found");

  const requiredAction = await getChangeNoticeRequiredAction(
    client,
    id,
    companyId
  );
  if (requiredAction.error) {
    throw redirect(
      `${path.to.changeNoticeRequiredActions}?${getParams(request)}`,
      await flash(
        request,
        error(requiredAction.error, "Failed to get change notice action")
      )
    );
  }

  return { requiredAction: requiredAction.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "parts"
  });

  const { id } = params;
  if (!id) {
    throw redirect(
      `${path.to.changeNoticeRequiredActions}?${getParams(request)}`,
      await flash(
        request,
        error(params, "Failed to get a change notice action id")
      )
    );
  }

  const { error: deleteError } = await deleteChangeNoticeRequiredAction(
    client,
    id,
    companyId
  );
  if (deleteError) {
    throw redirect(
      `${path.to.changeNoticeRequiredActions}?${getParams(request)}`,
      await flash(
        request,
        error(deleteError, "Failed to delete change notice action")
      )
    );
  }

  throw redirect(
    `${path.to.changeNoticeRequiredActions}?${getParams(request)}`,
    await flash(request, success("Successfully deleted change notice action"))
  );
}

export default function DeleteChangeNoticeRequiredActionRoute() {
  const { id } = useParams();
  const { requiredAction } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!requiredAction) return null;
  if (!id) throw notFound("id not found");

  const onCancel = () => navigate(path.to.changeNoticeRequiredActions);
  return (
    <ConfirmDelete
      action={path.to.deleteChangeNoticeRequiredAction(id)}
      name={requiredAction.name}
      text={t`Are you sure you want to delete the change notice action: ${requiredAction.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
