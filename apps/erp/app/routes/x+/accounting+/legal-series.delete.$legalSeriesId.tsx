import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteLegalSeries, getLegalSeriesById } from "~/modules/accounting";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "accounting"
  });
  const { legalSeriesId } = params;
  if (!legalSeriesId) throw notFound("legalSeriesId not found");

  const legalSeries = await getLegalSeriesById(client, legalSeriesId);
  if (legalSeries.error) {
    throw redirect(
      `${path.to.legalSeries}?${getParams(request)}`,
      await flash(
        request,
        error(legalSeries.error, "Failed to get legal series")
      )
    );
  }

  return { legalSeries: legalSeries.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "accounting"
  });

  const { legalSeriesId } = params;
  if (!legalSeriesId) {
    throw redirect(
      `${path.to.legalSeries}?${getParams(request)}`,
      await flash(request, error(params, "Failed to get a legal series id"))
    );
  }

  const { error: deleteTypeError } = await deleteLegalSeries(
    client,
    legalSeriesId
  );
  if (deleteTypeError) {
    throw redirect(
      `${path.to.legalSeries}?${getParams(request)}`,
      await flash(
        request,
        error(deleteTypeError, "Failed to delete legal series")
      )
    );
  }

  throw redirect(
    `${path.to.legalSeries}?${getParams(request)}`,
    await flash(request, success("Successfully deleted legal series"))
  );
}

export default function DeleteLegalSeriesRoute() {
  const { legalSeriesId } = useParams();
  const { legalSeries } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!legalSeriesId || !legalSeries) return null; // TODO - handle this better (404?)

  const onCancel = () => navigate(path.to.legalSeries);

  return (
    <ConfirmDelete
      action={path.to.deleteLegalSeries(legalSeriesId)}
      name={legalSeries.name}
      text={t`Are you sure you want to delete the legal series: ${legalSeries.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
