// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { fetchAllRecords } from "@carbon/database";
import { redirect } from "@carbon/utils";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { SupplierPartForm } from "~/modules/items/ui/Item";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");

  // Every item this supplier already has a supplier part for, inactive ones
  // included: the Parts tab lists only active rows, but a second row for the
  // same item and supplier is refused either way.
  const [existing, supplier] = await Promise.all([
    fetchAllRecords(() =>
      client
        .from("supplierPart")
        .select("itemId")
        .eq("supplierId", supplierId)
        .eq("companyId", companyId)
        .order("itemId")
    ),
    client
      .from("supplier")
      .select("currencyCode")
      .eq("id", supplierId)
      .eq("companyId", companyId)
      .single()
  ]);

  if (existing.error) {
    throw redirect(
      path.to.supplierParts(supplierId),
      await flash(
        request,
        error(existing.error, "Failed to load supplier parts")
      )
    );
  }

  return {
    excludeItemIds: (existing.data ?? []).map((part) => part.itemId),
    // The supplier is fixed on this form, so its currency is the default the
    // supplier field would otherwise set on change.
    currencyCode: supplier.data?.currencyCode ?? undefined
  };
}

// The form posts to the picked item's own create route, so this route has no
// action; the item decides the type and the inventory unit.
export default function SupplierNewSupplierPartRoute() {
  const { supplierId } = useParams();
  if (!supplierId) throw new Error("Could not find supplierId");

  const { excludeItemIds, currencyCode } = useLoaderData<typeof loader>();

  const navigate = useNavigate();
  const onClose = () => navigate(path.to.supplierParts(supplierId));

  const initialValues = {
    itemId: "",
    supplierId,
    supplierPartId: "",
    currencyCode,
    supplierUnitPrice: 0,
    supplierUnitOfMeasureCode: "EA",
    minimumOrderQuantity: 1,
    orderMultiple: 1,
    conversionFactor: 1
  };

  return (
    <SupplierPartForm
      selectItem
      excludeItemIds={excludeItemIds}
      type="Part"
      initialValues={initialValues}
      unitOfMeasureCode=""
      onClose={onClose}
    />
  );
}
