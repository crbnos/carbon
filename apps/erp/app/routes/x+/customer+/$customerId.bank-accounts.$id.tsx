import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { redirect, useNavigate, useParams } from "react-router";
import { useRouteData } from "~/hooks";
import type { CustomerBankAccount } from "~/modules/sales";
import {
  customerBankAccountValidator,
  upsertCustomerBankAccount
} from "~/modules/sales";
import CustomerBankAccountForm from "~/modules/sales/ui/Customer/CustomerBankAccountForm";
import { getDatabaseClient } from "~/services/database.server";
import { setCustomFields } from "~/utils/form";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { companyId, userId } = await requirePermissions(request, {
    update: "accounting"
  });

  const { customerId } = params;
  if (!customerId) throw new Error("Could not find customerId");

  const formData = await request.formData();

  const validation = await validator(customerBankAccountValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, ...rest } = validation.data;
  if (!id) throw new Error("Could not find id");

  try {
    // customerId and companyId come from the URL and the session, never from the
    // form body — the service re-asserts both in its WHERE clause so a forged
    // field cannot move this account to another customer.
    await upsertCustomerBankAccount(getDatabaseClient(), {
      ...rest,
      id,
      customerId,
      companyId,
      updatedBy: userId,
      customFields: setCustomFields(formData)
    });
  } catch (err) {
    throw redirect(
      path.to.customerBankAccounts(customerId),
      await flash(request, error(err, "Failed to update customer bank account"))
    );
  }

  return redirect(path.to.customerBankAccounts(customerId));
}

export default function EditCustomerBankAccountRoute() {
  const navigate = useNavigate();
  const { customerId, id } = useParams();
  if (!customerId) throw new Error("Could not find customerId");
  if (!id) throw new Error("Could not find id");

  const routeData = useRouteData<{ bankAccounts: CustomerBankAccount[] }>(
    path.to.customerBankAccounts(customerId)
  );

  const bankAccount = routeData?.bankAccounts.find(
    (account) => account.id === id
  );
  if (!bankAccount) throw new Error("Could not find bank account");

  const initialValues = {
    id: bankAccount.id,
    customerId: bankAccount.customerId,
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
    <CustomerBankAccountForm
      key={initialValues.id}
      initialValues={initialValues}
      onClose={() => navigate(path.to.customerBankAccounts(customerId))}
    />
  );
}
