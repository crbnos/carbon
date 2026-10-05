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
import { deleteSupplierType, getSupplierType } from "~/modules/purchasing";
import { getParams, path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "purchasing",
    role: "employee"
  });
  const { supplierTypeId } = params;
  if (!supplierTypeId) throw notFound("supplierTypeId not found");

  const supplierType = await getSupplierType(client, supplierTypeId);
  if (supplierType.error) {
    throw redirect(
      path.to.supplierTypes,
      await flash(
        request,
        error(supplierType.error, "Failed to get supplier type")
      )
    );
  }

  return { supplierType: supplierType.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "purchasing"
  });

  const { supplierTypeId } = params;
  if (!supplierTypeId) {
    throw redirect(
      `${path.to.supplierTypes}?${getParams(request)}`,
      await flash(request, error(params, "Failed to get an supplier type id"))
    );
  }

  const { error: deleteTypeError } = await deleteSupplierType(
    client,
    supplierTypeId
  );
  if (deleteTypeError) {
    throw redirect(
      `${path.to.supplierTypes}?${getParams(request)}`,
      await flash(
        request,
        error(deleteTypeError, "Failed to delete supplier type")
      )
    );
  }

  throw redirect(
    `${path.to.supplierTypes}?${getParams(request)}`,
    await flash(request, success("Successfully deleted supplier type"))
  );
}

export default function DeleteSupplierTypeRoute() {
  const { supplierTypeId } = useParams();
  const { supplierType } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const { t } = useLingui();

  if (!supplierType) return null;
  if (!supplierTypeId) throw notFound("supplierTypeId not found");

  const onCancel = () => navigate(path.to.supplierTypes);
  return (
    <ConfirmDelete
      action={path.to.deleteSupplierType(supplierTypeId)}
      name={supplierType.name}
      text={t`Are you sure you want to delete the supplier type: ${supplierType.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
