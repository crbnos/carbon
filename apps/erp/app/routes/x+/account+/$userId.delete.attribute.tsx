// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { carbon } from "@carbon/api/carbon.server";
import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { deleteUserAttributeValueValidator } from "~/modules/users/users.models";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(deleteUserAttributeValueValidator).request(
    args,
    { params: ["userId"] }
  );
  if ("invalid" in input) return input.invalid;
  const api = await carbon(args.request);
  return api.users.deleteAttributeValue({
    ...input.data,
    userId: input.params.userId
  });
}

export default function UserAttributeValueRoute() {
  // React Router bug
  return null;
}
