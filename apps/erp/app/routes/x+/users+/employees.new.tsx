import {
  assertIsPost,
  CONTROLLED_ENVIRONMENT,
  error,
  RESEND_DOMAIN,
  success
} from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { getCarbonServiceRole } from "@carbon/auth/client.server";
import { flash } from "@carbon/auth/session.server";
import { InviteEmail } from "@carbon/documents/email";
import { getSsoAwareInviteLink } from "@carbon/ee/sso.server";
import { validationError, validator } from "@carbon/form";
import { sendEmail } from "@carbon/lib/resend.server";
import { getLogger } from "@carbon/logger";
import { datetime } from "@carbon/utils";
import { render } from "@react-email/components";
import { nanoid } from "nanoid";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  CreateEmployeeModal,
  createEmployeeValidator,
  getInvitable
} from "~/modules/users";
import {
  createEmployeeAccount,
  getSsoInviteDomainError
} from "~/modules/users/users.server";
import { path } from "~/utils/path";
import { getCompanyId, invalidateUserSelectQueries } from "~/utils/react-query";

const logger = getLogger("erp", "employees-new");

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    create: "users"
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

  return {
    invitable: invitable.data ?? []
  };
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "users"
  });

  const validation = await validator(createEmployeeValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const {
    email,
    firstName,
    lastName,
    locationId,
    employeeType,
    usPersonAttestation
  } = validation.data;

  // Controlled environments require the inviter to attest the invitee is a
  // U.S. person (22 CFR 120.62) before the invite can be created.
  if (CONTROLLED_ENVIRONMENT && !usPersonAttestation) {
    return validationError({
      fieldErrors: {
        usPersonAttestation:
          "You must confirm a reasonable basis that this individual is a U.S. person"
      }
    });
  }

  // Once SSO is active for the company, an employee invite outside its
  // covered domains is refused before anything is created or emailed.
  const ssoDomainError = await getSsoInviteDomainError(
    getCarbonServiceRole(),
    companyId,
    email
  );
  if (ssoDomainError) {
    return validationError({
      fieldErrors: { email: ssoDomainError }
    });
  }

  const result = await createEmployeeAccount(client, {
    email: email.toLowerCase(),
    firstName,
    lastName,
    employeeType,
    locationId,
    companyId,
    createdBy: userId,
    attestedBy: CONTROLLED_ENVIRONMENT ? userId : null,
    attestedAt: CONTROLLED_ENVIRONMENT ? datetime.timestamp() : null
  });

  if (!result.success) {
    logger.error(result);
    throw redirect(
      path.to.employeeAccounts,
      await flash(
        request,
        error(result, result.message ?? "Failed to create employee account")
      )
    );
  }

  const location = request.headers.get("x-vercel-ip-city") ?? "Unknown";
  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
  const [company, user] = await Promise.all([
    client.from("company").select("name").eq("id", companyId).single(),
    client.from("user").select("email, fullName").eq("id", userId).single()
  ]);

  if (!company.data || !user.data) {
    throw new Error("Failed to load company or user");
  }

  const inviteLink = await getSsoAwareInviteLink(
    getCarbonServiceRole(),
    email,
    result.code,
    companyId
  );

  await sendEmail({
    from: `Carbon <no-reply@${RESEND_DOMAIN}>`,
    to: email,
    subject: `You have been invited to join ${company.data?.name} on Carbon`,
    headers: {
      "X-Entity-Ref-ID": nanoid()
    },
    html: await render(
      InviteEmail({
        invitedByEmail: user.data.email,
        invitedByName: user.data.fullName ?? "",
        email,
        name: `${firstName} ${lastName}`.trim(),
        companyName: company.data.name,
        inviteLink,
        ip,
        location,
        controlledEnvironment: CONTROLLED_ENVIRONMENT
      })
    )
  });

  throw redirect(
    path.to.personJob(result.userId),
    await flash(request, success("Successfully invited employee"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  invalidateUserSelectQueries(getCompanyId());
  return await serverAction();
}

export default function () {
  const { invitable } = useLoaderData<typeof loader>();

  return <CreateEmployeeModal invitable={invitable} />;
}
