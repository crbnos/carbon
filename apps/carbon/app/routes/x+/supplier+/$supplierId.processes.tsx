import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  SupplierProcesses,
  getSupplierProcessesBySupplier,
} from "~/modules/purchasing";

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { path } from "~/utils/path";

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
