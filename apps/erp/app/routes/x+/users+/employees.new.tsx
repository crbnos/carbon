import {
  assertIsPost,
  error,
  getAppUrl,
  RESEND_DOMAIN,
  success,
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { InviteEmail } from "@carbon/documents/email";
import { validationError, validator } from "@carbon/form";
import { resend } from "@carbon/lib/resend.server";
import { render } from "@react-email/components";
import { useLoaderData } from "@remix-run/react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@vercel/remix";
import { json, redirect } from "@vercel/remix";
import { nanoid } from "nanoid";
import {
  CreateEmployeeModal,
  createEmployeeValidator,
  getInvitable,
} from "~/modules/users";
import { createEmployeeAccount } from "~/modules/users/users.server";
import { path } from "~/utils/path";

export const config = {
  runtime: "nodejs",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "users",
  });

  const invitable = await getInvitable(client, companyId);
  if (invitable.error) {
    throw redirect(
      path.to.employeeAccounts,
      await flash(
        request,
        error(invitable.error, "Failed to load invitable users")
      )
    );
  }

  return json({
    invitable: invitable.data ?? [],
  });
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "users",
  });

  const validation = await validator(createEmployeeValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { email, firstName, lastName, locationId, employeeType } =
    validation.data;

  const result = await createEmployeeAccount(client, {
    email: email.toLowerCase(),
    firstName,
    lastName,
    employeeType,
    locationId,
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
    from: `Carbon <no-reply@${RESEND_DOMAIN}>`,
    to: email,
    subject: `You have been invited to join ${company.data?.name} on Carbon`,
    headers: {
      "X-Entity-Ref-ID": nanoid(),
    },
    html: await render(
      InviteEmail({
        invitedByEmail: user.data.email,
        invitedByName: user.data.fullName ?? "",
        email,
        companyName: company.data.name,
        inviteLink: `${getAppUrl()}/invite/${result.code}`,
        ip,
        location,
      })
    ),
  });

  console.log(invitationEmail);

  throw redirect(
    path.to.personJob(result.userId),
    await flash(request, success("Successfully invited employee"))
  );
}

export default function () {
  const { invitable } = useLoaderData<typeof loader>();

  return <CreateEmployeeModal invitable={invitable} />;
}
