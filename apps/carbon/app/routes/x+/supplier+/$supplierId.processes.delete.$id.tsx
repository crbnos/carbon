import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useNavigate, useParams } from "@remix-run/react";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { ConfirmDelete } from "~/components/Modals";
import { useRouteData } from "~/hooks";
import {
  deleteSupplierProcess,
  type SupplierProcess,
} from "~/modules/purchasing";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "purchasing",
  });

  const { supplierId, id } = params;
  if (!supplierId) throw new Error("Could not find supplierId");
  if (!id) throw new Error("Could not find id");

  const update = await deleteSupplierProcess(client, id);

  if (update.error) {
    throw redirect(
      path.to.supplierProcesses(supplierId),
      await flash(
        request,
        error(update.error, "Failed to delete supplier process")
      )
    );
  }

  return redirect(path.to.supplierProcesses(supplierId));
}

export default function DeleteSupplierProcessRoute() {
  const navigate = useNavigate();
  const { supplierId, id } = useParams();
  if (!supplierId) throw new Error("Could not find supplier id");
  if (!id) throw new Error("Could not find id");
  const routeData = useRouteData<{ processes: SupplierProcess[] }>(
    path.to.supplierProcesses(supplierId)
  );

  const process = routeData?.processes.find((process) => process.id === id);
  if (!process) throw new Error("Could not find process");

  return (
    <ConfirmDelete
      action={path.to.deleteSupplierProcess(supplierId, id)}
      isOpen
      name={process.processName!}
      text={`Are you sure you want to permanently delete the supplier process?`}
      onCancel={() => {
        navigate(-1);
      }}
    />
  );
}
