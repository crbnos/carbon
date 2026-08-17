import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { VStack } from "@carbon/react";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { Outlet, redirect, useLoaderData } from "react-router";
import {
  EmployeesTable,
  getEmployees,
  getEmployeeTypes,
  getUnrevokedInviteEmails,
  getUsersWithVerifiedMfa
} from "~/modules/users";
import type { Handle } from "~/utils/handle";
import { path } from "~/utils/path";
import { getGenericQueryFilters } from "~/utils/query";

export const handle: Handle = {
  breadcrumb: msg`Employees`,
  to: path.to.employeeAccounts
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    view: "users",
    role: "employee",
    bypassRls: true
  });

  const url = new URL(request.url);
  const searchParams = new URLSearchParams(url.search);
  const search = searchParams.get("search");

  const { limit, offset, sorts, filters } =
    getGenericQueryFilters(searchParams);

  const [employees, employeeTypes, invites, mfaUsers] = await Promise.all([
    getEmployees(client, companyId, { search, limit, offset, sorts, filters }),
    getEmployeeTypes(client, companyId),
    getUnrevokedInviteEmails(client, companyId),
    getUsersWithVerifiedMfa(client, companyId)
  ]);

  if (mfaUsers.error) {
    getLogger("users").error("Failed to load MFA status for employees", {
      error: mfaUsers.error,
      companyId
    });
  }

  if (employees.error) {
    throw redirect(
      path.to.users,
      await flash(request, error(employees.error, "Error loading employees"))
    );
  }
  if (employeeTypes.error) {
    throw redirect(
      path.to.users,
      await flash(
        request,
        error(employeeTypes.error, "Error loading employee types")
      )
    );
  }

  return {
    count: employees.count ?? 0,
    employees: employees.data ?? [],
    employeeTypes: employeeTypes.data,
    unrevokedInviteEmails: invites.data?.map((i) => i.email) ?? [],
    // Surfaced rather than swallowed: a missing/stale RPC (e.g. PostgREST's
    // schema cache not yet reloaded after the migration) otherwise looks
    // exactly like "nobody has 2FA", which is a silently wrong answer.
    mfaEnrolledUserIds: mfaUsers.error
      ? []
      : ((mfaUsers.data as { userId: string }[] | null)?.map((r) => r.userId) ??
        [])
  };
}

export default function UsersEmployeesRoute() {
  const {
    count,
    employees,
    employeeTypes,
    unrevokedInviteEmails,
    mfaEnrolledUserIds
  } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <EmployeesTable
        data={employees}
        count={count}
        employeeTypes={employeeTypes}
        unrevokedInviteEmails={unrevokedInviteEmails}
        mfaEnrolledUserIds={mfaEnrolledUserIds}
      />
      <Outlet />
    </VStack>
  );
}
