import { assertIsPost, getAppUrl, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { InviteEmail } from "@carbon/documents/email";
import { validationError, validator } from "@carbon/form";
import { resend } from "@carbon/lib/resend.server";
import { render } from "@react-email/components";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { nanoid } from "nanoid";
import {
  CreateSupplierModal,
  createSupplierAccountValidator,
} from "~/modules/users";
import { createSupplierAccount } from "~/modules/users/users.server";
import { path } from "~/utils/path";

export const config = {
  runtime: "nodejs",
};

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    view: "users",
  });

  const validation = await validator(createSupplierAccountValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const supplierRedirect = searchParams.get("supplier");

  const { id, supplier } = validation.data;
  const result = await createSupplierAccount(client, {
    id,
    supplierId: supplier,
    companyId,
    createdBy: userId,
  });

  if (!result.success) {
    console.error(result);
    throw redirect(path.to.employeeAccounts, await flash(request, result));
  }

  const location = request.headers.get("x-vercel-ip-city") ?? "Unknown";
  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
  const [company, user] = await Promise.all([
    client.from("company").select("name").eq("id", companyId).single(),
    client.from("user").select("email, fullName").eq("id", userId).single(),
  ]);

  if (!company.data || !user.data) {
    throw new Error("Failed to load company or user");
  }

  const invitationEmail = await resend.emails.send({
    from: "Carbon <no-reply@carbon.ms>",
    to: result.email,
    subject: `You have been invited to join ${company.data?.name} on Carbon`,
    headers: {
      "X-Entity-Ref-ID": nanoid(),
    },
    html: await render(
      InviteEmail({
        invitedByEmail: user.data.email,
        invitedByName: user.data.fullName ?? "",
        email: result.email,
        companyName: company.data.name,
        inviteLink: `${getAppUrl()}/invite/${result.code}`,
        ip,
        location,
      })
    ),
  });

  console.log(invitationEmail);

  if (supplierRedirect) {
    throw redirect(
      path.to.supplierContacts(supplierRedirect),
      await flash(request, success("Supplier invited"))
    );
  }

  throw redirect(
    path.to.supplierAccounts,
    await flash(request, success("Supplier invited"))
  );
}

export default function () {
  return <CreateSupplierModal />;
}
