// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteScrapReason, getScrapReason } from "~/modules/production";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "production",
    role: "employee"
  });
  const { scrapReasonId } = params;
  if (!scrapReasonId) throw notFound("scrapReasonId not found");

  const scrapReason = await getScrapReason(client, scrapReasonId);
  if (scrapReason.error) {
    throw redirect(
      `${path.to.customerStatuses}?${getParams(request)}`,
      await flash(
        request,
        error(scrapReason.error, "Failed to get scrap reason")
      )
    );
  }

  return { scrapReason: scrapReason.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "production"
  });

  const { scrapReasonId } = params;
  if (!scrapReasonId) {
    throw redirect(
      `${path.to.scrapReasons}?${getParams(request)}`,
      await flash(request, error(params, "Failed to get an scrap reason id"))
    );
  }

  const { error: deleteScrapReasonError } = await deleteScrapReason(
    client,
    scrapReasonId
  );
  if (deleteScrapReasonError) {
    const errorMessage =
      deleteScrapReasonError.code === "23503"
        ? "Scrap reason is used elsewhere, cannot delete"
        : "Failed to delete scrap reason";

    throw redirect(
      `${path.to.scrapReasons}?${getParams(request)}`,
      await flash(request, error(deleteScrapReasonError, errorMessage))
    );
  }

  throw redirect(
    `${path.to.scrapReasons}?${getParams(request)}`,
    await flash(request, success("Successfully deleted scrap reason"))
  );
}

export default function DeleteScrapReasonRoute() {
  const { scrapReasonId } = useParams();
  const { scrapReason } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!scrapReason) return null;
  if (!scrapReasonId) throw notFound("scrapReasonId not found");

  const onCancel = () => navigate(path.to.scrapReasons);
  return (
    <ConfirmDelete
      action={path.to.deleteScrapReason(scrapReasonId)}
      name={scrapReason.name}
      text={t`Are you sure you want to delete the scrap reason: ${scrapReason.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
