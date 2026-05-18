import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteNoQuoteReason, getNoQuoteReason } from "~/modules/sales";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "sales",
    role: "employee"
  });
  const { id } = params;
  if (!id) throw notFound("id not found");

  const noQuoteReason = await getNoQuoteReason(id);
  if (noQuoteReason.error) {
    throw redirect(
      `${path.to.customerStatuses}?${getParams(request)}`,
      await flash(
        request,
        error(noQuoteReason.error, "Failed to get no quote reason")
      )
    );
  }

  return { noQuoteReason: noQuoteReason.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requirePermissions(request, {
    delete: "sales"
  });

  const { id } = params;
  if (!id) {
    throw redirect(
      `${path.to.noQuoteReasons}?${getParams(request)}`,
      await flash(request, error(params, "Failed to get an no quote reason id"))
    );
  }

  const { error: deleteNoQuoteReasonError } = await deleteNoQuoteReason(id);
  if (deleteNoQuoteReasonError) {
    const errorMessage =
      deleteNoQuoteReasonError.code === "23503"
        ? "No quote reason is used elsewhere, cannot delete"
        : "Failed to delete noQuote reason";

    throw redirect(
      `${path.to.noQuoteReasons}?${getParams(request)}`,
      await flash(request, error(deleteNoQuoteReasonError, errorMessage))
    );
  }

  throw redirect(
    `${path.to.noQuoteReasons}?${getParams(request)}`,
    await flash(request, success("Successfully deleted noQuote reason"))
  );
}

export default function DeleteNoQuoteReasonRoute() {
  const { t } = useLingui();
  const { id } = useParams();
  const { noQuoteReason } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!noQuoteReason) return null;
  if (!id) throw notFound("id not found");

  const onCancel = () => navigate(path.to.noQuoteReasons);
  return (
    <ConfirmDelete
      action={path.to.deleteNoQuoteReason(id)}
      name={noQuoteReason.name}
      text={t`Are you sure you want to delete the no quote reason: ${noQuoteReason.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
