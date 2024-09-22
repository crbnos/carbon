import { useLoaderData, useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { ConfirmDelete } from "~/components/Modals";
import { deleteSupplierStatus, getSupplierStatus } from "~/modules/purchasing";
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
  const { supplierStatusId } = params;
  if (!supplierStatusId) throw notFound("supplierStatusId not found");

  const supplierStatus = await getSupplierStatus(client, supplierStatusId);
  if (supplierStatus.error) {
    throw redirect(
      `${path.to.supplierStatuses}?${getParams(request)}`,
      await flash(
        request,
        error(supplierStatus.error, "Failed to get supplier status")
      )
    );
  }

  return json({ supplierStatus: supplierStatus.data });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "purchasing",
  });

  const { supplierStatusId } = params;
  if (!supplierStatusId) {
    throw redirect(
      `${path.to.supplierStatuses}?${getParams(request)}`,
      await flash(request, error(params, "Failed to get an supplier status id"))
    );
  }

  const { error: deleteStatusError } = await deleteSupplierStatus(
    client,
    supplierStatusId
  );
  if (deleteStatusError) {
    throw redirect(
      `${path.to.supplierStatuses}?${getParams(request)}`,
      await flash(
        request,
        error(deleteStatusError, "Failed to delete supplier status")
      )
    );
  }

  throw redirect(
    `${path.to.supplierStatuses}?${getParams(request)}`,
    await flash(request, success("Successfully deleted supplier status"))
  );
}

export default function DeleteSupplierStatusRoute() {
  const { supplierStatusId } = useParams();
  const { supplierStatus } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!supplierStatus) return null;
  if (!supplierStatusId) throw notFound("supplierStatusId not found");

  const onCancel = () => navigate(path.to.supplierStatuses);
  return (
    <ConfirmDelete
      action={path.to.deleteSupplierStatus(supplierStatusId)}
      name={supplierStatus.name}
      text={`Are you sure you want to delete the supplier status: ${supplierStatus.name}? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
