// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { BulkInviteEmployeesModal } from "~/modules/users/ui";
import { bulkCreateEmployeeValidator } from "~/modules/users/users.models";
import { originOf } from "~/modules/users/users.service";
import { path } from "~/utils/path";

export async function loader({ request }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    create: "users"
  });

  return {};
}

export async function action(args: ActionFunctionArgs) {
  await requirePermissions(args.request, {
    create: "users"
  });
  const input = await validator(bulkCreateEmployeeValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { ip, city } = originOf(args.request);
  const api = await carbon(args.request);
  const result = await api.users.bulkInviteEmployees({
    employees: input.data.employees,
    ip,
    city
  });
  if (result.error) {
    throw new Error(result.error.message);
  }
  if (result.data.success) {
    throw redirect(
      path.to.employeeAccounts,
      await flash(args.request, success(result.data.message))
    );
  }
  return result.data;
}

export default function () {
  return <BulkInviteEmployeesModal />;
}
