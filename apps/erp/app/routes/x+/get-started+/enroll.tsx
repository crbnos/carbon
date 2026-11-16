// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize } from "@carbon/auth/auth.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs } from "react-router";
import { path } from "~/utils/path";

// The home page's Implementation Hub card: enroll, then open the hub.
export async function action(args: ActionFunctionArgs) {
  const input = await validator().request(args);
  if ("invalid" in input) return input.invalid;
  const { api } = await authorize(args.request);
  const result = await api.shared.enrollImplementationHub({});
  if (result.error) return result;
  throw redirect(path.to.getStarted);
}
