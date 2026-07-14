import { error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { deleteSupplierPart } from "~/modules/items";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "parts"
  });

  const { supplierPartId } = params;
  if (!supplierPartId) throw notFound("supplierPartId not found");

  // @ts-ignore TS2589 — Supabase joined-select type instantiation too deep; it
  // fires only under some checker states, so ignore (not expect-error) stays
  // green whether or not it triggers.
  const result = await client
    .from("supplierPart")
    .select("id, supplierId, supplier:supplierId(name)")
    .eq("id", supplierPartId)
    .eq("companyId", companyId)
    .single();

  if (result.error || !result.data) {
    throw notFound("Supplier part not found");
  }

  return { supplierPart: result.data };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "parts"
  });

  const { itemId, supplierPartId } = params;
  if (!itemId) throw notFound("Could not find itemId");
  if (!supplierPartId) throw notFound("Could not find supplierPartId");

  const { error: deleteError } = await deleteSupplierPart(
    client,
    supplierPartId,
    companyId
  );

  if (deleteError) {
    throw redirect(
      path.to.materialPurchasing(itemId),
      await flash(request, error(deleteError, "Failed to delete supplier part"))
    );
  }

  throw redirect(
    path.to.materialPurchasing(itemId),
    await flash(request, success("Supplier part deleted"))
  );
}

export default function DeleteMaterialSupplierRoute() {
  const { t } = useLingui();
  const { itemId, supplierPartId } = useParams();
  const { supplierPart } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  if (!itemId) throw notFound("Could not find itemId");
  if (!supplierPartId) throw notFound("Could not find supplierPartId");

  const supplierName =
    (supplierPart?.supplier as { name?: string } | null)?.name ??
    t`this supplier`;

  const onCancel = () => navigate(path.to.materialPurchasing(itemId));

  return (
    <ConfirmDelete
      action={path.to.deleteMaterialSupplier(itemId, supplierPartId)}
      name={t`Supplier Part`}
      text={t`Are you sure you want to remove ${supplierName} as a supplier for this item? This cannot be undone.`}
      onCancel={onCancel}
    />
  );
}
