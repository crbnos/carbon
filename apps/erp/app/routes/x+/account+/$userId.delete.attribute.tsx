import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { deleteUserAttributeValue } from "~/modules/account/account.service.server";
import { getAttribute } from "~/modules/people/people.service.server";
import { getUserClaims } from "~/modules/users/users.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { companyId, userId } = await requirePermissions(request, {});
  const { userId: targetUserId } = params;

  if (!targetUserId) {
    throw new Error("No user id provided");
  }

  const formData = await request.formData();

  const userAttributeId = formData.get("userAttributeId") as string;
  if (!userAttributeId) throw new Error("No attribute id provided");

  const userAttributeValueId = formData.get("userAttributeValueId") as string;
  if (!userAttributeValueId) throw new Error("No attribute value id provided");

  const clientClaims = await getUserClaims(userId, companyId);
  const canUpdateAnyUser =
    // biome-ignore lint/complexity/useLiteralKeys: suppressed due to migration
    clientClaims.permissions["resources"]?.update?.includes(companyId);

  if (!canUpdateAnyUser && userId !== targetUserId) {
    return data(
      null,
      await flash(request, error(null, "Unauthorized: Cannot remove attribute"))
    );
  }

  if (!canUpdateAnyUser && userId === targetUserId) {
    // check if this is a self managed attribute
    const attribute = await getAttribute(userAttributeId);
    if (attribute.error) {
      return data(
        null,
        await flash(request, error(attribute.error, "Failed to get attribute"))
      );
    }

    const canSelfManage = attribute.data?.canSelfManage ?? false;
    if (!canSelfManage) {
      return data(
        null,
        await flash(
          request,
          error(null, "Unauthorized: Cannot remove attribute")
        )
      );
    }
  }

  const removeAttributeValue = await deleteUserAttributeValue({
    userAttributeId: userAttributeId,
    userAttributeValueId: userAttributeValueId
  });
  if (removeAttributeValue.error) {
    return data(
      null,
      await flash(
        request,
        error(removeAttributeValue.error, "Failed to delete attribute value")
      )
    );
  }

  return data(null, await flash(request, success("Deleted attribute value")));
}

export default function UserAttributeValueRoute() {
  // React Router bug
  return null;
}
