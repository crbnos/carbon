import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { useLingui } from "@lingui/react/macro";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs
} from "react-router";
import { redirect, useNavigate, useParams } from "react-router";
import { ConfirmDelete } from "~/components/Modals";
import { useRouteData } from "~/hooks";
import type { SupplierProcess } from "~/modules/purchasing";
import { deleteSupplierProcess } from "~/modules/purchasing";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "purchasing"
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

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  // Remove (not just invalidate) the cached supplier processes. The consuming
  // clientLoader reads via getQueryData and only refetches on a cache miss, so
  // invalidateQueries alone leaves stale data (a deleted supplier) in the
  // dropdown until a hard refresh. removeQueries forces a server refetch.
  window.clientCache?.removeQueries({
    queryKey: ["supplierProcesses"]
  });
  return await serverAction();
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

  const { t } = useLingui();

  return (
    <ConfirmDelete
      action={path.to.deleteSupplierProcess(supplierId, id)}
      isOpen
      name={process.processName!}
      text={t`Are you sure you want to permanently delete the supplier process?`}
      onCancel={() => {
        navigate(-1);
      }}
    />
  );
}
