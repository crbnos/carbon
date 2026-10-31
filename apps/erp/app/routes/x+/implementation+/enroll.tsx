// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { isInternalEmail, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { path } from "~/utils/path";

// Enroll the company (on Implementation Hub 2.0 when staff enroll and the
// flag is on), then go where the form says: the Settings page by default, the
// people's pages from the home card and the hub's own notice. `redirect` stays
// on this origin whatever the form sends.
const enrollValidator = z.object({
  redirectTo: zfd.text(z.string().optional())
});

export async function action(args: ActionFunctionArgs) {
  const input = await validator(enrollValidator).request(args);
  if ("invalid" in input) return input.invalid;
  // Carbon staff enroll from the Implementation Hub Settings page, settings
  // permission or not.
  const { email } = await requirePermissions(args.request, {});
  const api = await carbon(args.request);
  const result = isInternalEmail(email)
    ? await api.shared.enrollImplementationHubAsStaff({})
    : await api.shared.enrollImplementationHub({});
  if (result.error) return result;
  throw redirect(input.data.redirectTo ?? path.to.implementationSettings);
}
