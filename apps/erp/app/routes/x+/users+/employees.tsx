// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { error } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { getLogger } from "@carbon/logger";
import { RecordOutlet, VStack } from "@carbon/react";
import { redirect } from "@carbon/utils";
import { msg } from "@lingui/core/macro";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { EmployeesTable } from "~/modules/users/ui";
import {
  getEmployeeTypes,
  getUnrevokedInviteEmails,
  getUsersWithVerifiedMfa
} from "~/modules/users/users.service";
import type { Handle } from "~/utils/handle";
import { loadListPage } from "~/utils/list-registry/load.server";
import { employeeAccountsList } from "~/utils/list-registry/users.server";
import { path } from "~/utils/path";

export const handle: Handle = {
  breadcrumb: msg`Employees`,
  to: path.to.employeeAccounts
};

export async function loader({ request }: LoaderFunctionArgs) {
  return loadListPage(request, employeeAccountsList, {
    dataKey: "employees",
    bypassRls: true,
    // The invites and the MFA users cover the whole company, so page 1 has them.
    firstPage: async ({ client, companyId }) => {
      const [employeeTypes, invites, mfaUsers] = await Promise.all([
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
        employeeTypes: employeeTypes.data ?? [],
        unrevokedInviteEmails: invites.data?.map((i) => i.email) ?? [],
        // Surfaced rather than swallowed: a missing/stale RPC (e.g. PostgREST's
        // schema cache not yet reloaded after the migration) otherwise looks
        // exactly like "nobody has 2FA", which is a silently wrong answer.
        mfaEnrolledUserIds: mfaUsers.error
          ? []
          : ((mfaUsers.data as { userId: string }[] | null)?.map(
              (r) => r.userId
            ) ?? [])
      };
    },
    onError: { redirectTo: path.to.users, message: "Error loading employees" }
  });
}

export default function UsersEmployeesRoute() {
  const {
    count,
    employees,
    infinite,
    employeeTypes,
    unrevokedInviteEmails,
    mfaEnrolledUserIds
  } = useLoaderData<typeof loader>();

  return (
    <VStack spacing={0} className="h-full">
      <EmployeesTable
        data={employees}
        count={count}
        infinite={infinite}
        employeeTypes={employeeTypes}
        unrevokedInviteEmails={unrevokedInviteEmails}
        mfaEnrolledUserIds={mfaEnrolledUserIds}
      />
      <RecordOutlet />
    </VStack>
  );
}
