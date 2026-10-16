// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { validator } from "@carbon/form";
import type { ActionFunctionArgs } from "react-router";
import { carbon, redirectWithResult } from "~/modules/carbon.server";
import { GroupForm, groupValidator } from "~/modules/users";
import { path } from "~/utils/path";

export async function action(args: ActionFunctionArgs) {
  const input = await validator(groupValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { name, selections } = input.data;
  const api = await carbon(args.request);
  const result = await api.users.group.create({ name, selections });
  return redirectWithResult(args.request, result, {
    to: result.error ? path.to.newGroup : path.to.groups,
    message: "Group created"
  });
}

export default function NewGroupRoute() {
  const initialValues = {
    id: "",
    name: "",
    selections: []
  };

  return <GroupForm initialValues={initialValues} />;
}
