import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useNavigate, useParams } from "react-router";
import {
  customerWarrantyTermValidator,
  upsertCustomerWarrantyTerm
} from "~/modules/sales";
import CustomerWarrantyTermForm from "~/modules/sales/ui/Customer/CustomerWarrantyTermForm";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, { create: "sales", role: "employee" });
  return null;
}

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "sales",
    role: "employee"
  });

  const { customerId } = params;
  if (!customerId) throw new Error("Could not find customerId");

  const formData = await request.formData();
  const validation = await validator(customerWarrantyTermValidator).validate(
    formData
  );
  if (validation.error) return validationError(validation.error);

  // biome-ignore lint/correctness/noUnusedVariables: id is stripped for insert
  const { id, ...d } = validation.data;

  const insert = await upsertCustomerWarrantyTerm(client, {
    ...d,
    companyId,
    createdBy: userId
  });

  if (insert.error) {
    throw redirect(
      path.to.customerWarranties(customerId),
      await flash(
        request,
        error(
          insert.error,
          // The partial unique indexes are what make this reachable.
          "Failed to add the rule — this customer may already have one for that item"
        )
      )
    );
  }

  throw redirect(
    path.to.customerWarranties(customerId),
    await flash(request, success("Warranty rule added"))
  );
}

export default function NewCustomerWarrantyTermRoute() {
  const navigate = useNavigate();
  const { customerId } = useParams();
  if (!customerId) throw new Error("Could not find customerId");

  return (
    <CustomerWarrantyTermForm
      initialValues={{ customerId, warrantyTermId: "" }}
      onClose={() => navigate(path.to.customerWarranties(customerId))}
    />
  );
}
