// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbonFor } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import SupplierProcesses from "~/modules/purchasing/ui/Supplier/SupplierProcesses";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const auth = await requirePermissions(request, {
    view: "purchasing"
  });
  const api = carbonFor(auth);

  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");

  const processes = await api.purchasing.getSupplierProcessesBySupplier({
    supplierId
  });

  if (processes.error || !processes.data) {
    throw redirect(
      path.to.supplier(supplierId),
      await flash(
        request,
        error(processes.error, "Failed to load supplier payment")
      )
    );
  }

  return {
    processes: processes.data
  };
}

export default function SupplierPaymentRoute() {
  const { processes } = useLoaderData<typeof loader>();

  return (
    <>
      <SupplierProcesses processes={processes} />
      <RecordOutlet />
    </>
  );
}
