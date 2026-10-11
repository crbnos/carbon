// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { RecordOutlet } from "@carbon/react";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { getSupplierPartsBySupplier } from "~/modules/items";
import SupplierParts from "~/modules/purchasing/ui/Supplier/SupplierParts";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");

  const supplierParts = await getSupplierPartsBySupplier(
    client,
    supplierId,
    companyId
  );

  if (supplierParts.error) {
    throw redirect(
      path.to.supplier(supplierId),
      await flash(
        request,
        error(supplierParts.error, "Failed to load supplier parts")
      )
    );
  }

  return {
    supplierParts: (supplierParts.data ?? []).sort((a, b) =>
      (a.item?.readableIdWithRevision ?? "").localeCompare(
        b.item?.readableIdWithRevision ?? ""
      )
    )
  };
}

export default function SupplierPartsRoute() {
  const { supplierParts } = useLoaderData<typeof loader>();

  return (
    <>
      <SupplierParts supplierParts={supplierParts} />
      <RecordOutlet />
    </>
  );
}
