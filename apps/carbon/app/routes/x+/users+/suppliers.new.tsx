import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import {
  CreateSupplierModal,
  createSupplierAccountValidator,
} from "~/modules/users";
import { createSupplierAccount } from "~/modules/users/users.server";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    view: "users",
  });
  const formData = await request.formData();
  const validation = await validator(createSupplierAccountValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const supplierRedirect = searchParams.get("supplier");

  const { id, supplier } = validation.data;
  const result = await createSupplierAccount(client, {
    id,
    supplierId: supplier,
    companyId,
  });

  if (supplierRedirect) {
    throw redirect(
      path.to.supplierContacts(supplierRedirect),
      await flash(request, result)
    );
  }

  throw redirect(path.to.supplierAccounts, await flash(request, result));
}

export default function () {
  return <CreateSupplierModal />;
}
