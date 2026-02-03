import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import type {
  ActionFunctionArgs,
  ClientActionFunctionArgs
} from "react-router";
import { data, redirect } from "react-router";
import {
  deleteGroup,
  GroupForm,
  groupValidator,
  insertGroup,
  upsertGroupMembers
} from "~/modules/users";
import { path } from "~/utils/path";
import { getCompanyId } from "~/utils/react-query";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, companyId } = await requirePermissions(request, {
    create: "users"
  });

  const validation = await validator(groupValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { name, selections } = validation.data;

  const createGroup = await insertGroup(client, { name, companyId });
  if (createGroup.error) {
    return data(
      {},
      await flash(request, error(createGroup.error, "Failed to insert group"))
    );
  }

  const groupId = createGroup.data?.id;
  if (!groupId) {
    return data(
      {},
      await flash(request, error(createGroup, "Failed to insert group"))
    );
  }

  const insertGroupMembers = await upsertGroupMembers(
    client,
    groupId,
    selections
  );

  if (insertGroupMembers.error) {
    await deleteGroup(client, groupId);
    return data(
      {},
      await flash(
        request,
        error(insertGroupMembers.error, "Failed to insert group members")
      )
    );
  }

  throw redirect(
    path.to.groups,
    await flash(request, success("Group created"))
  );
}

export async function clientAction({ serverAction }: ClientActionFunctionArgs) {
  const companyId = getCompanyId();
  window.clientCache?.invalidateQueries({
    predicate: (query) => {
      const queryKey = query.queryKey as string[];
      return queryKey[0] === "groupsByType" && queryKey[1] === companyId;
    }
  });
  return await serverAction();
}

export default function NewGroupRoute() {
  const initialValues = {
    id: "",
    name: "",
    selections: []
  };

  return <GroupForm initialValues={initialValues} />;
}
