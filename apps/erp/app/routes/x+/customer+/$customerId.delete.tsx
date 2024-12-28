import { json, redirect } from "@remix-run/react";

import { assertIsPost, error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { deleteCustomer } from "~/modules/sales";
import { path } from "~/utils/path";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client } = await requirePermissions(request, {
    delete: "sales",
  });

  const { customerId } = params;
  if (!customerId) throw new Error("Could not find customerId");

  const customerDelete = await deleteCustomer(client, customerId);

  if (customerDelete.error) {
    return json(
      path.to.customers,
      await flash(
        request,
        error(customerDelete.error, customerDelete.error.message)
      )
    );
  }

  throw redirect(path.to.customers);
}
