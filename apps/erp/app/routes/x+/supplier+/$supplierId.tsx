// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { authorize } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { getDocumentApprovalState } from "@carbon/ee/approvals/document.server";
import { RecordOutlet } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import SupplierHeader from "~/modules/purchasing/ui/Supplier/SupplierHeader";
import SupplierSidebar from "~/modules/purchasing/ui/Supplier/SupplierSidebar";
import { detailBreadcrumb, type Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: detailBreadcrumb(
    { breadcrumb: msg`Suppliers`, to: path.to.suppliers },
    (data) => data?.supplier?.name
  ),
  module: "purchasing"
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { companyId, userId, api } = await authorize(request, {
    view: "purchasing"
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");

  const supplierPromise = api.purchasing.getSupplier({ supplierId });
  const [supplier, contacts, locations, tags, supplierTax, approval] =
    await Promise.all([
      supplierPromise,
      api.purchasing.getSupplierContacts({ supplierId }),
      api.purchasing.getSupplierLocations({ supplierId }),
      api.shared.getTagsList({ table: "supplier" }),
      api.purchasing.getSupplierTax({ supplierId }),
      getDocumentApprovalState(getCarbonServiceRole(), {
        documentType: "supplier",
        documentId: supplierId,
        companyId,
        userId
      })
    ]);

  if (supplier.error) {
    throw redirect(
      path.to.suppliers,
      await flash(
        request,
        error(supplier.error, "Failed to load supplier summary")
      )
    );
  }

  return {
    supplier: supplier.data,
    contacts: contacts.data ?? [],
    locations: locations.data ?? [],
    tags: tags.data ?? [],
    supplierTax: supplierTax.data,
    approval
  };
}

export default function SupplierRoute() {
  return (
    <>
      <SupplierHeader />
      <div className="grid grid-cols-1 md:grid-cols-[1fr_4fr] h-full w-full gap-4 max-md:h-auto max-md:gap-0">
        <SupplierSidebar />
        <RecordOutlet />
      </div>
    </>
  );
}
