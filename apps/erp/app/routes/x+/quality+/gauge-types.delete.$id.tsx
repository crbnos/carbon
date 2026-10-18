// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error, notFound, success } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getDatabaseErrorMessage, redirect } from "@carbon/utils";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteGaugeType } from "~/modules/quality/quality.service";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "quality",
    role: "employee"
  });
  const { id } = params;
  if (!id) throw notFound("id not found");

  const gaugeType = await api.quality.getGaugeType({ gaugeTypeId: id });
  if (gaugeType.error) {
    throw redirect(
      `${path.to.gaugeTypes}?${getParams(request)}`,
      await flash(request, error(gaugeType.error, "Failed to get gauge type"))
    );
  }

  return { gaugeType: gaugeType.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await authorize(request, {
    delete: "quality"
  });

  const { id } = params;
  if (!id) {
    throw redirect(
      `${path.to.gaugeTypes}?${getParams(request)}`,
      await flash(request, error(params, "Failed to get a gauge type id"))
    );
  }

  const { error: deleteGaugeTypeError } = await deleteGaugeType(client, id);
  if (deleteGaugeTypeError) {
    const errorMessage = getDatabaseErrorMessage(
      deleteGaugeTypeError,
      "Failed to delete gauge type",
      { referenced: "Gauge type is used elsewhere, cannot delete" }
    );

    throw redirect(
      `${path.to.gaugeTypes}?${getParams(request)}`,
      await flash(request, error(deleteGaugeTypeError, errorMessage))
    );
  }

  throw redirect(
    `${path.to.gaugeTypes}?${getParams(request)}`,
    await flash(request, success("Successfully deleted gauge type"))
  );
}

export default function DeleteGaugeTypesRoute() {
  const { id } = useParams();
  const { gaugeType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!gaugeType) return null;
  if (!id) throw notFound("id not found");

  const onCancel = () => navigate(path.to.gaugeTypes);
  return (
    <ConfirmDelete
      action={path.to.deleteGaugeType(id)}
      name={gaugeType.name}
      text={t`Are you sure you want to delete the gauge type: ${gaugeType.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
