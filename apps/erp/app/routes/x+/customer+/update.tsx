// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { datetime } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId, userId } = await requirePermissions(request, {
    update: "sales"
  });

  const formData = await request.formData();
  const ids = formData.getAll("ids").filter((id) => typeof id === "string");
  const field = formData.get("field");
  const value = formData.get("value");

  if (typeof field !== "string" || typeof value !== "string") {
    return { error: { message: "Invalid form data" }, data: null };
  }

  switch (field) {
    case "taxCodeId": {
      if (!value) {
        return { error: { message: "Select a tax code" }, data: null };
      }

      const [taxCode, customers] = await Promise.all([
        client
          .from("taxCode")
          .select("id")
          .eq("id", value)
          .eq("companyId", companyId)
          .eq("active", true)
          .maybeSingle(),
        client
          .from("customer")
          .select("id")
          .in("id", ids)
          .eq("companyId", companyId)
      ]);
      if (taxCode.error) return { error: taxCode.error, data: null };
      if (!taxCode.data) {
        return { error: { message: "Tax code not found" }, data: null };
      }
      if (customers.error) return { error: customers.error, data: null };

      const customerIds = customers.data.map((customer) => customer.id);
      if (customerIds.length === 0) {
        return { error: { message: "No customers found" }, data: null };
      }

      // The customer insert interceptor creates the customerTax row, so this
      // normally updates. It upserts to cover a row that is missing, which
      // needs the service role: customerTax has no INSERT policy. Every id
      // was checked against the company above, so the conflict update only
      // reaches this company's rows.
      return await getCarbonServiceRole()
        .from("customerTax")
        .upsert(
          customerIds.map((customerId) => ({
            customerId,
            companyId,
            taxCodeId: taxCode.data.id,
            updatedBy: userId,
            updatedAt: datetime.timestamp()
          })),
          { onConflict: "customerId" }
        );
    }
    default:
      return { error: { message: "Invalid field" }, data: null };
  }
}
