import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { useUser } from "~/hooks";
import { supplierValidator, upsertSupplier } from "~/modules/purchasing";
import SupplierForm from "~/modules/purchasing/ui/Supplier/SupplierForm";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Suppliers",
  to: path.to.suppliers,
  module: "purchasing"
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing"
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(supplierValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: suppressed due to migration
  const { id, ...d } = validation.data;

  const createSupplier = await upsertSupplier(client, {
    ...d,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData)
  });
  if (createSupplier.error) {
    return modal
      ? data(
          createSupplier,
          await flash(
            request,
            error(createSupplier.error, createSupplier.error.message)
          )
        )
      : redirect(
          path.to.suppliers,
          await flash(
            request,
            error(createSupplier.error, createSupplier.error.message)
          )
        );
  }

  const supplierId = createSupplier.data?.id;

  return modal ? createSupplier : redirect(path.to.supplier(supplierId));
}

export default function SuppliersNewRoute() {
  const { company } = useUser();

  const initialValues = {
    name: "",
    currencyCode: company?.baseCurrencyCode ?? undefined,
    phone: "",
    fax: "",
    website: ""
  };
  return (
    <div className="max-w-4xl w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <SupplierForm initialValues={initialValues} />
    </div>
  );
}
