import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { deleteSupplierContact } from "~/modules/purchasing";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { path } from "~/utils/path";
import { error, success } from "~/utils/result";

export async function action({ request, params }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "purchasing",
  });

  const { supplierId, supplierContactId } = params;
  if (!supplierId || !supplierContactId) {
    throw redirect(
      path.to.suppliers,
      await flash(request, error(params, "Failed to get a supplier contact id"))
    );
  }

  // TODO: check whether this person has an account or is a partner first

  const { error: deleteSupplierContactError } = await deleteSupplierContact(
    client,
    supplierId,
    supplierContactId
  );
  if (deleteSupplierContactError) {
    throw redirect(
      path.to.supplierContacts(supplierId),
      await flash(
        request,
        error(deleteSupplierContactError, "Failed to delete supplier contact")
      )
    );
  }

  throw redirect(
    path.to.supplierContacts(supplierId),
    await flash(request, success("Successfully deleted supplier contact"))
  );
}
