// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/api/carbon.server";
import { error, notFound, success } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteDimension } from "~/modules/accounting/accounting.service";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "accounting"
  });
  const { dimensionId } = params;
  if (!dimensionId) throw notFound("dimensionId not found");

  const dimension = await api.accounting.getDimension({ dimensionId });
  if (dimension.error) {
    throw redirect(
      `${path.to.dimensions}?${getParams(request)}`,
      await flash(request, error(dimension.error, "Failed to get dimension"))
    );
  }

  return { dimension: dimension.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await authorize(request, {
    delete: "accounting"
  });

  const { dimensionId } = params;
  if (!dimensionId) {
    throw redirect(
      `${path.to.dimensions}?${getParams(request)}`,
      await flash(request, error(params, "Failed to get a dimension id"))
    );
  }

  const { error: deleteError } = await deleteDimension(client, dimensionId);
  if (deleteError) {
    throw redirect(
      `${path.to.dimensions}?${getParams(request)}`,
      await flash(request, error(deleteError, "Failed to delete dimension"))
    );
  }

  throw redirect(
    `${path.to.dimensions}?${getParams(request)}`,
    await flash(request, success("Successfully deleted dimension"))
  );
}

export default function DeleteDimensionRoute() {
  const { dimensionId } = useParams();
  const { dimension } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!dimensionId || !dimension) return null;

  const onCancel = () => navigate(path.to.dimensions);

  return (
    <ConfirmDelete
      action={path.to.deleteDimension(dimensionId)}
      name={dimension.name}
      text={`Are you sure you want to delete the dimension: ${dimension.name}? This will also delete all associated values. This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
