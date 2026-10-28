// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { requirePermissions } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { isInternalEmail, redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { path } from "~/utils/path";

// The hub's Settings page: enroll the company (on the Personal Pages layout
// when staff enroll), then show the settings again.
export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args);
  if ("invalid" in input) return input.invalid;
  // Carbon staff enroll from the hub's Settings page, settings permission or
  // not.
  const { email } = await requirePermissions(args.request, {});
  const api = await carbon(args.request);
  const result = isInternalEmail(email)
    ? await api.shared.enrollImplementationHubAsStaff({})
    : await api.shared.enrollImplementationHub({});
  if (result.error) return result;
  throw redirect(path.to.implementationSettings);
}
