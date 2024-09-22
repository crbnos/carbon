import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  SupplierProcesses,
  getSupplierProcessesBySupplier,
} from "~/modules/purchasing";

import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { path } from "~/utils/path";
import { error } from "~/utils/result";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client } = await requirePermissions(request, {
    view: "purchasing",
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");

  const processes = await getSupplierProcessesBySupplier(client, supplierId);

  if (processes.error || !processes.data) {
    throw redirect(
      path.to.supplier(supplierId),
      await flash(
        request,
        error(processes.error, "Failed to load supplier payment")
      )
    );
  }

  return json({
    processes: processes.data,
  });
}

export default function SupplierPaymentRoute() {
  const { processes } = useLoaderData<typeof loader>();

  return (
    <>
      <SupplierProcesses processes={processes} />
      <Outlet />
    </>
  );
}
