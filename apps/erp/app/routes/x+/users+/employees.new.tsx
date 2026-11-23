// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon, respond } from "@carbon/api/carbon.server";
import { error } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { CreateEmployeeModal } from "~/modules/users/ui";
import {
  createEmployeeValidator,
  US_PERSON_ATTESTATION_REQUIRED
} from "~/modules/users/users.models";
import { getInvitable, originOf } from "~/modules/users/users.service";
import { path } from "~/utils/path";

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

export async function action(args: ActionFunctionArgs) {
  const input = await validator(createEmployeeValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { ip, city } = originOf(args.request);
  const api = await carbon(args.request);
  const result = await api.users.inviteEmployee({ ...input.data, ip, city });
  if (result.error?.message === US_PERSON_ATTESTATION_REQUIRED) {
    return validationError({
      fieldErrors: { usPersonAttestation: result.error.message }
    });
  }
  // The SSO domain check, the operation's only rule refusal.
  if (result.error?.category === "rule") {
    return validationError({ fieldErrors: { email: result.error.message } });
  }
  return respond(args.request, result).redirect(
    result.data
      ? path.to.personJob(result.data.userId)
      : path.to.employeeAccounts,
    { message: "Successfully invited employee" }
  );
}

export default function NewEmployeeRoute() {
  const { invitable } = useLoaderData<typeof loader>();

  return <CreateEmployeeModal invitable={invitable} />;
}
