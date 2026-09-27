import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect, useNavigate, useParams } from "react-router";
import { useUser } from "~/hooks";
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
    create: "accounting"
  });

  const formData = await request.formData();
  const modal = formData.get("type") === "modal";

  const { supplierId } = params;
  if (!supplierId) throw notFound("supplierId not found");

  const validation = await validator(supplierBankAccountValidator).validate(
    formData
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  // biome-ignore lint/correctness/noUnusedVariables: id is absent on create
  const { id, ...rest } = validation.data;

  let created: { id: string };
  try {
    // supplierId and companyId come from the URL and the session, never from the
    // form body.
    created = await upsertSupplierBankAccount(getDatabaseClient(), {
      ...rest,
      supplierId,
      companyId,
      createdBy: userId,
      customFields: setCustomFields(formData)
    });
  } catch (err) {
    if (modal) {
      return data(
        { error: "Failed to create supplier bank account" },
        { status: 500 }
      );
    }
    throw redirect(
      path.to.supplierBankAccounts(supplierId),
      await flash(request, error(err, "Failed to create supplier bank account"))
    );
  }

  return modal
    ? data(created, { status: 201 })
    : redirect(
        path.to.supplierBankAccounts(supplierId),
        await flash(request, success("Supplier bank account created"))
      );
}

export default function NewSupplierBankAccountRoute() {
  const navigate = useNavigate();
  const { company } = useUser();
  const { supplierId } = useParams();
  if (!supplierId) throw new Error("supplierId not found");

  const initialValues = {
    supplierId,
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
    <SupplierBankAccountForm
      initialValues={initialValues}
      onClose={() => navigate(path.to.supplierBankAccounts(supplierId))}
    />
  );
}
