import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import {
  SupplierForm,
  supplierValidator,
  upsertSupplier,
} from "~/modules/purchasing";
import { setCustomFields } from "~/utils/form";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: "Suppliers",
  to: path.to.suppliers,
  module: "purchasing",
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "purchasing",
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const validation = await validator(supplierValidator).validate(formData);

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...data } = validation.data;

  const createSupplier = await upsertSupplier(client, {
    ...data,
    companyId,
    createdBy: userId,
    customFields: setCustomFields(formData),
  });
  if (createSupplier.error) {
    return modal
      ? json(
          createSupplier,
          await flash(
            request,
            error(createSupplier.error, "Failed to insert supplier")
          )
        )
      : redirect(
          path.to.suppliers,
          await flash(
            request,
            error(createSupplier.error, "Failed to insert supplier")
          )
        );
  }

  const supplierId = createSupplier.data?.id;

  return modal ? json(createSupplier) : redirect(path.to.supplier(supplierId));
}

export default function SuppliersNewRoute() {
  const initialValues = {
    name: "",
  };
  return (
    <div className="max-w-[50rem] w-full p-2 sm:p-0 mx-auto mt-0 md:mt-8">
      <SupplierForm initialValues={initialValues} />
    </div>
  );
}
