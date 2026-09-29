import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { SupplierBankAccount } from "~/modules/purchasing";
import {
  supplierBankAccountValidator,
  upsertSupplierBankAccount
} from "~/modules/purchasing";
import SupplierBankAccountForm from "~/modules/purchasing/ui/Supplier/SupplierBankAccountForm";
import { getDatabaseClient } from "~/services/database.server";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const { supplierId } = params;
  if (!supplierId) throw new Error("Could not find supplierId");

  const formData = await request.formData();

  const validation = await validator(supplierBankAccountValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...rest } = validation.data;
  if (!id) throw new Error("Could not find id");

  try {
    // supplierId and companyId come from the URL and the session, never from the
    // form body — the service re-asserts both in its WHERE clause so a forged
    // field cannot move this account to another supplier.
    await upsertSupplierBankAccount(getDatabaseClient(), {
      ...rest,
      id,
      supplierId,
      companyId,
      updatedBy: userId,
      customFields: setCustomFields(formData)
    });
  } catch (err) {
    throw redirect(
      path.to.supplierBankAccounts(supplierId),
      await flash(request, error(err, "Failed to update supplier bank account"))
    );
  }

  return redirect(path.to.supplierBankAccounts(supplierId));
}

export default function EditSupplierBankAccountRoute() {
  const navigate = useNavigate();
  const { supplierId, id } = useParams();
  if (!supplierId) throw new Error("Could not find supplierId");
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<{ bankAccounts: SupplierBankAccount[] }>(
    path.to.supplierBankAccounts(supplierId)
  );

  const bankAccount = routeData?.bankAccounts.find(
    (account) => account.id === id
  );
  if (!bankAccount) throw new Error("Could not find bank account");

  const initialValues = {
    id: bankAccount.id,
    supplierId: bankAccount.supplierId,
    name: bankAccount.name ?? "",
    accountHolderName: bankAccount.accountHolderName ?? "",
    bankName: bankAccount.bankName ?? "",
    bankAddress: bankAccount.bankAddress ?? "",
    countryCode: bankAccount.countryCode ?? "",
    currencyCode: bankAccount.currencyCode ?? "",
    accountNumber: bankAccount.accountNumber ?? "",
    bankCode: bankAccount.bankCode ?? "",
    swiftBic: bankAccount.swiftBic ?? "",
    notes: bankAccount.notes ?? ""
  };

  return (
    <SupplierBankAccountForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(path.to.supplierBankAccounts(supplierId))}
    />
  );
}
