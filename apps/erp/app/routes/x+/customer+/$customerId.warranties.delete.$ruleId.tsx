import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { deleteCustomerWarrantyTerm } from "~/modules/sales";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    delete: "sales",
    role: "employee"
  });

  const { customerId, ruleId } = params;
  if (!customerId || !ruleId) throw new Error("Could not find id");

  const remove = await deleteCustomerWarrantyTerm(client, ruleId, companyId);
  if (remove.error) {
    throw redirect(
      path.to.customerWarranties(customerId),
      await flash(request, error(remove.error, "Failed to delete the rule"))
    );
  }

  throw redirect(
    path.to.customerWarranties(customerId),
    await flash(request, success("Warranty rule removed"))
  );
}
