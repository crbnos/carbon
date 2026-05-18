import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  getSupplierTax,
  supplierTaxValidator,
  updateSupplierTax
} from "~/modules/purchasing";
import { SupplierTaxForm } from "~/modules/purchasing/ui/Supplier";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "purchasing"
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");

  const supplierTax = await getSupplierTax(supplierId);

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
    supplierTax: supplierTax.data
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
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

  const update = await updateSupplierTax({
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
  const { supplierId, supplierTax } = useLoaderData<typeof loader>();
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
      supplierTax?.taxExemptionCertificatePath ?? null
  };

  return <SupplierTaxForm initialValues={initialValues} />;
}
