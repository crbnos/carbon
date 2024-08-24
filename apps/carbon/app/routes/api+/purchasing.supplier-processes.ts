import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { getSupplierProcessesByProcess } from "~/modules/purchasing";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { error } from "~/utils/result";

export async function loader({ request }: LoaderFunctionArgs) {
  const authorized = await requirePermissions(request, {
    view: "purchasing",
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const processId = searchParams.get("processId") as string;

  if (!processId || processId === "undefined")
    return json({
      data: [],
    });

  const processes = await getSupplierProcessesByProcess(
    authorized.client,
    processId
  );
  if (processes.error) {
    return json(
      processes,
      await flash(
        request,
        error(processes.error, "Failed to get supplier processes")
      )
    );
  }

  return json(processes);
}
