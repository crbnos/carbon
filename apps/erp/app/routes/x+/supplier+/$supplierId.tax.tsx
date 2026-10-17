// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { suggestTaxCodes } from "~/modules/accounting";
import {
  getSupplierLocation,
  getSupplierLocations,
  getSupplierPayment,
  getSupplierTax,
  supplierTaxValidator,
  updateSupplierTax
} from "~/modules/purchasing";
import { SupplierTaxForm } from "~/modules/purchasing/ui/Supplier";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "purchasing"
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");

  const [supplierTax, suggestedTaxCode] = await Promise.all([
    getSupplierTax(client, supplierId),
    getSuggestedTaxCode(client, companyId, supplierId)
  ]);

  if (supplierTax.error) {
    throw redirect(
      path.to.supplier(supplierId),
      await flash(
        request,
        error(supplierTax.error, "Failed to load supplier tax information")
      )
    );
  }

  return {
    supplierId,
    supplierTax: supplierTax.data,
    suggestedTaxCode
  };
}

/**
 * The first active tax code that matches the supplier's address: the
 * location the supplier invoices from, else its first location. A suggestion
 * only — the user confirms it.
 */
async function getSuggestedTaxCode(
  client: Parameters<typeof getSupplierTax>[0],
  companyId: string,
  supplierId: string
) {
  const payment = await getSupplierPayment(client, supplierId);
  const invoiceLocationId = payment.data?.invoiceSupplierLocationId;
  const address = invoiceLocationId
    ? (await getSupplierLocation(client, invoiceLocationId)).data?.address
    : ((await getSupplierLocations(client, supplierId)).data?.[0]?.address ??
      null);
  const countryCode = address?.country?.alpha2 ?? null;
  if (!countryCode) return null;

  const suggestions = await suggestTaxCodes(client, companyId, {
    countryCode,
    state: address?.stateProvince || null
  });
  return suggestions.data?.[0] ?? null;
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "purchasing"
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");

  const formData = await request.formData();
  const validation = await validator(supplierTaxValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const taxExemptionCertificatePath =
    formData.get("taxExemptionCertificatePath")?.toString() || null;

  const update = await updateSupplierTax(client, {
    ...validation.data,
    supplierId,
    companyId,
    taxExemptionCertificatePath,
    updatedBy: userId
  });
  if (update.error) {
    throw redirect(
      path.to.supplier(supplierId),
      await flash(
        request,
        error(update.error, "Failed to update supplier tax information")
      )
    );
  }

  throw redirect(
    path.to.supplierTax(supplierId),
    await flash(request, success("Updated supplier tax information"))
  );
}

export default function SupplierTaxRoute() {
  const { supplierId, supplierTax, suggestedTaxCode } =
    useLoaderData<typeof loader>();
  const initialValues = {
    supplierId: supplierTax?.supplierId ?? supplierId,
    taxId: supplierTax?.taxId ?? "",
    vatNumber: supplierTax?.vatNumber ?? "",
    eori: supplierTax?.eori ?? "",
    taxExempt: supplierTax?.taxExempt ?? false,
    taxExemptionReason: supplierTax?.taxExemptionReason ?? undefined,
    taxExemptionCertificateNumber:
      supplierTax?.taxExemptionCertificateNumber ?? "",
    taxExemptionCertificatePath:
      supplierTax?.taxExemptionCertificatePath ?? null,
    taxCodeId: supplierTax?.taxCodeId ?? undefined
  };

  return (
    <SupplierTaxForm
      initialValues={initialValues}
      suggestedTaxCode={suggestedTaxCode}
    />
  );
}
