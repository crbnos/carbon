import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type {
  ClientLoaderFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { data } from "react-router";
import { getSupplierProcessesByProcess } from "~/modules/purchasing";
import { supplierProcessesQuery } from "~/utils/react-query";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const authorized = await requirePermissions(request, {});

  const { processId } = params;

  if (!processId)
    return {
      data: []
    };

  const processes = await getSupplierProcessesByProcess(
    authorized.client,
    processId
  );
  if (processes.error) {
    return data(
      processes,
      await flash(
        request,
        error(processes.error, "Failed to get supplier processes")
      )
    );
  }

  return processes;
}

export async function clientLoader({
  serverLoader,
  params
}: ClientLoaderFunctionArgs) {
  const { processId } = params;

  if (!processId) {
    return await serverLoader<typeof loader>();
  }

  const queryKey = supplierProcessesQuery(processId).queryKey;
  const data =
    window?.clientCache?.getQueryData<Awaited<ReturnType<typeof loader>>>(
      queryKey
    );

  if (!data) {
    const serverData = await serverLoader<typeof loader>();
    window?.clientCache?.setQueryData(queryKey, serverData);
    return serverData;
  }

  return data;
}
clientLoader.hydrate = true;
