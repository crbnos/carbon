import {
  assertIsPost,
  CONTROLLED_ENVIRONMENT,
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
import { datetime } from "@carbon/utils";
import { render } from "@react-email/components";
import { nanoid } from "nanoid";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs,
  LoaderFunctionArgs
} from "react-router";
import { redirect } from "react-router";
import {
  BulkInviteEmployeesModal,
  bulkCreateEmployeeValidator
} from "~/modules/users";
import type { BulkInviteResult } from "~/modules/users/ui/Employees/BulkInviteEmployeesModal";
import { createEmployeeAccount } from "~/modules/users/users.server";
import { path } from "~/utils/path";
import { getCompanyId, invalidateUserSelectQueries } from "~/utils/react-query";

const logger = getLogger("erp", "employees-bulk-invite");

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "users"
  });

  return {};
}

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId, userId } = await requirePermissions(request, {
    create: "users"
  });

  const validation = await validator(bulkCreateEmployeeValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { employees } = validation.data;

  const location = request.headers.get("x-vercel-ip-city") ?? "Unknown";
  const ip = request.headers.get("x-forwarded-for") ?? "127.0.0.1";
  const [company, user] = await Promise.all([
    client.from("company").select("name").eq("id", companyId).single(),
    client.from("user").select("email, fullName").eq("id", userId).single()
  ]);

  if (!company.data || !user.data) {
    throw new Error("Failed to load company or user");
  }

  const results: BulkInviteResult[] = [];

  for (const [index, employee] of employees.entries()) {
    const email = employee.email.toLowerCase();
    const {
      firstName,
      lastName,
      locationId,
      employeeType,
      usPersonAttestation
    } = employee;

    if (CONTROLLED_ENVIRONMENT && !usPersonAttestation) {
      results.push({
        index,
        email,
        success: false,
        message:
          "You must confirm a reasonable basis that this individual is a U.S. person"
      });
      continue;
    }

    const result = await createEmployeeAccount(client, {
      email,
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
      results.push({
        index,
        email,
        success: false,
        message: result.message ?? "Failed to create employee account"
      });
      continue;
    }

    try {
      const emailResult = await sendEmail({
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
            inviteLink: `${getAppUrl()}/invite/${result.code}`,
            ip,
            location,
            controlledEnvironment: CONTROLLED_ENVIRONMENT
          })
        )
      });

      if (emailResult.error) {
        logger.error(emailResult.error.message ?? "Email send failed");
        results.push({
          index,
          email,
          success: false,
          message: "Created, but invite email failed to send"
        });
        continue;
      }

      results.push({
        index,
        email,
        success: true,
        message: "Invited"
      });
    } catch (emailError) {
      logger.error(
        emailError instanceof Error ? emailError.message : "Email send failed"
      );
      results.push({
        index,
        email,
        success: false,
        message: "Created, but invite email failed to send"
      });
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.length - succeeded;
  const message =
    failed === 0
      ? `Successfully invited ${succeeded} employee${succeeded === 1 ? "" : "s"}`
      : `${succeeded} of ${results.length} invited successfully, ${failed} failed`;

  if (failed === 0) {
    throw redirect(
      path.to.employeeAccounts,
      await flash(request, success(message))
    );
  }

  // Partial or total failure: stay on the modal with per-row feedback.
  return {
    success: false,
    message,
    results
  };
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  try {
    return await serverAction();
  } finally {
    invalidateUserSelectQueries(getCompanyId());
  }
}

export default function () {
  return <BulkInviteEmployeesModal />;
}
