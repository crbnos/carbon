// SPDX-License-Identifier: AGPL-3.0-only
// Carbon (github.com/crbnos/carbon). Modified or adapted versions of this file,
// including ports, remain AGPLv3; serving them over a network requires releasing their source.

import { authorize, respond } from "@carbon/api/carbon.server";
import { error, notFound } from "@carbon/auth";
import { flash } from "@carbon/auth/session.server";
import { validator } from "@carbon/form";
import { redirect } from "@carbon/utils";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { GroupForm } from "~/modules/users/ui";
import { groupValidator } from "~/modules/users/users.models";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { api } = await authorize(request, {
    view: "users",
    role: "employee"
  });

  const { groupId } = params;
  if (!groupId) throw notFound("groupId not found");

  const groupWithMembers = await api.users.getGroupMembers({ groupId });

  if (groupWithMembers.error) {
    redirect(
      path.to.groups,
      await flash(
        request,
        error(groupWithMembers.error, "Failed to load group")
      )
    );
  }

  const groupName = groupWithMembers.data?.[0].name;
  if (!groupName)
    throw redirect(
      path.to.groups,
      await flash(request, error(groupWithMembers, "Group not found"))
    );

  const group = {
    id: groupId,
    name: groupName,
    selections:
      groupWithMembers.data?.map((group) =>
        group.memberGroupId
          ? `group_${group.memberGroupId}`
          : `user_${group.memberUserId}`
      ) || []
  };

  return { group };
}

export async function action(args: ActionFunctionArgs) {
  const input = await validator(groupValidator).request(args);
  if ("invalid" in input) return input.invalid;
  const { api } = await authorize(args.request);
  const result = await api.users.updateGroup(input.data);
  return respond(args.request, result).redirect(path.to.groups, {
    message: "Group updated successfully"
  });
}

export default function UsersGroupRoute() {
  const { group } = useLoaderData<typeof loader>();

  const initialValues = {
    id: group?.id || "",
    name: group?.name || "",
    selections: group?.selections || []
  };

  return <GroupForm key={initialValues.id} initialValues={initialValues} />;
}
