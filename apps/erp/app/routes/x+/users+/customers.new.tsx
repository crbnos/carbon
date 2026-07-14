import {
  assertIsPost,
  error,
  getAppUrl,
  RESEND_DOMAIN,
  success
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { InviteEmail } from "@carbon/documents/email";
import { validationError, validator } from "@carbon/form";
import { sendEmail } from "@carbon/lib/resend.server";
import { getLogger } from "@carbon/logger";
import { render } from "@react-email/components";
import { nanoid } from "nanoid";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import {
  CreateCustomerModal,
  createCustomerAccountValidator
} from "~/modules/users";
import { createCustomerAccount } from "~/modules/users/users.server";
import { path } from "~/utils/path";

const logger = getLogger("erp", "customers-new");

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "users"
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
    createdBy: userId
  });

  if (!result.success) {
    logger.error(result);
    throw redirect(
      path.to.customerAccounts,
      await flash(
        request,
        error(result, result.message ?? "Failed to create customer account")
      )
    );
  }

  const location = request.headers.get("x-vercel-ip-city") ?? "Unknown";
  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
  const [company, user, invitee] = await Promise.all([
    client.from("company").select("name").eq("id", companyId).single(),
    client.from("user").select("email, fullName").eq("id", userId).single(),
    client.from("user").select("fullName").eq("id", result.userId).single()
  ]);

  if (!company.data || !user.data) {
    throw new Error("Failed to load company or user");
  }

  await sendEmail({
    from: `Carbon <no-reply@${RESEND_DOMAIN}>`,
    to: result.email,
    subject: `You have been invited to join ${company.data?.name} on Carbon`,
    headers: {
      "X-Entity-Ref-ID": nanoid()
    },
    html: await render(
      InviteEmail({
        invitedByEmail: user.data.email,
        invitedByName: user.data.fullName ?? "",
        email: result.email,
        name: invitee.data?.fullName ?? "",
        companyName: company.data.name,
        inviteLink: `${getAppUrl()}/invite/${result.code}`,
        ip,
        location
      })
    )
  });

  if (customerRedirect) {
    throw redirect(
      path.to.customerContacts(customerRedirect),
      await flash(request, success("Customer invited"))
    );
  }

  throw redirect(
    path.to.customerAccounts,
    await flash(request, success("Customer invited"))
  );
}

export default function () {
  return <CreateCustomerModal />;
}
