import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect, useNavigate, useParams } from "react-router";
import { useUser } from "~/hooks";
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
    create: "accounting"
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const { customerId } = params;
  if (!customerId) throw notFound("customerId not found");

  const validation = await validator(customerBankAccountValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: id is absent on create
  const { id, ...rest } = validation.data;

  let created: { id: string };
  try {
    // customerId and companyId come from the URL and the session, never from the
    // form body.
    created = await upsertCustomerBankAccount(getDatabaseClient(), {
      ...rest,
      customerId,
      companyId,
      createdBy: userId,
      customFields: setCustomFields(formData)
    });
  } catch (err) {
    if (modal) {
      return data(
        { error: "Failed to create customer bank account" },
        { status: 500 }
      );
    }
    throw redirect(
      path.to.customerBankAccounts(customerId),
      await flash(request, error(err, "Failed to create customer bank account"))
    );
  }

  return modal
    ? data(created, { status: 201 })
    : redirect(
        path.to.customerBankAccounts(customerId),
        await flash(request, success("Customer bank account created"))
      );
}

export default function NewCustomerBankAccountRoute() {
  const navigate = useNavigate();
  const { company } = useUser();
  const { customerId } = useParams();
  if (!customerId) throw new Error("customerId not found");

  const initialValues = {
    customerId,
    name: "",
    accountHolderName: "",
    bankName: "",
    bankAddress: "",
    countryCode: company?.countryCode ?? "",
    currencyCode: company?.baseCurrencyCode ?? "",
    accountNumber: "",
    bankCode: "",
    swiftBic: "",
    notes: ""
  };

  return (
    <CustomerBankAccountForm
      initialValues={initialValues}
      onClose={() => navigate(path.to.customerBankAccounts(customerId))}
    />
  );
}
