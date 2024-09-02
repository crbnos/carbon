import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import {
  CreateCustomerModal,
  createCustomerAccountValidator,
} from "~/modules/users";
import { createCustomerAccount } from "~/modules/users/users.server";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { assertIsPost } from "~/utils/http";
import { path } from "~/utils/path";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    view: "users",
  });

  const validation = await validator(createCustomerAccountValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const customerRedirect = searchParams.get("customer");

  const { id, customer } = validation.data;
  const result = await createCustomerAccount(client, {
    id,
    customerId: customer,
    companyId,
  });

  if (customerRedirect) {
    throw redirect(
      path.to.customerContacts(customerRedirect),
      await flash(request, result)
    );
  }

  throw redirect(path.to.customerAccounts, await flash(request, result));
}

export default function () {
  return <CreateCustomerModal />;
}
