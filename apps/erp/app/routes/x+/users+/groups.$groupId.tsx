import { assertIsPost, error, notFound, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import {
  GroupForm,
  getGroupMembers,
  groupValidator,
  upsertGroup,
  upsertGroupMembers
} from "~/modules/users";
import { path } from "~/utils/path";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requirePermissions(request, {
    view: "users",
    role: "employee"
  });

  const { groupId } = params;
  if (!groupId) throw notFound("groupId not found");

  const groupWithMembers = await getGroupMembers(groupId);

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

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {
    view: "users"
  });

  const validation = await validator(groupValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { id, name, selections } = validation.data;

  const [updateGroup, updateGroupMembers] = await Promise.all([
    upsertGroup({ id, name }),
    upsertGroupMembers(id, selections)
  ]);

  if (updateGroup.error)
    redirect(
      path.to.groups,
      await flash(request, error(updateGroup.error, "Failed to update group"))
    );

  if (updateGroupMembers.error)
    redirect(
      path.to.groups,
      await flash(
        request,
        error(updateGroupMembers.error, "Failed to update group members")
      )
    );

  throw redirect(
    path.to.groups,
    await flash(request, success("Group updated successfully"))
  );
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
