import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ConfirmDelete } from "~/components/Modals";
import { deleteSupplierType, getSupplierType } from "~/modules/purchasing";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { notFound } from "~/utils/http";
import { getParams, path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "purchasing",
    role: "employee",
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

  return json({ supplierType: supplierType.data });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "purchasing",
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

  if (!supplierType) return null;
  if (!supplierTypeId) throw notFound("supplierTypeId not found");

  const onCancel = () => navigate(path.to.supplierTypes);
  return (
    <ConfirmDelete
      action={path.to.deleteSupplierType(supplierTypeId)}
      name={supplierType.name}
      text={`Are you sure you want to delete the supplier type: ${supplierType.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
