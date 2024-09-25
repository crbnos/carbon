import { assertIsPost, error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { deleteUserAttributeValue } from "~/modules/account";
import { getAttribute } from "~/modules/people";
import { getUserClaims } from "~/modules/users/users.server";

export async function action({ request, params }: ActionFunctionArgs) {
  assertIsPost(request);

  const { client, companyId, userId } = await requirePermissions(request, {});
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
    clientClaims.permissions["resources"]?.update?.includes(companyId);

  if (!canUpdateAnyUser && userId !== targetUserId) {
    return json(
      null,
      await flash(request, error(null, "Unauthorized: Cannot remove attribute"))
    );
  }

  if (!canUpdateAnyUser && userId === targetUserId) {
    // check if this is a self managed attribute
    const attribute = await getAttribute(client, userAttributeId);
    if (attribute.error) {
      return json(
        null,
        await flash(request, error(attribute.error, "Failed to get attribute"))
      );
    }

    const canSelfManage = attribute.data?.canSelfManage ?? false;
    if (!canSelfManage) {
      return json(
        null,
        await flash(
          request,
          error(null, "Unauthorized: Cannot remove attribute")
        )
      );
    }
  }

  const removeAttributeValue = await deleteUserAttributeValue(client, {
    userId: targetUserId,
    userAttributeId: userAttributeId,
    userAttributeValueId: userAttributeValueId,
  });
  if (removeAttributeValue.error) {
    return json(
      null,
      await flash(
        request,
        error(removeAttributeValue.error, "Failed to delete attribute value")
      )
    );
  }

  return json(null, await flash(request, success("Deleted attribute value")));
}

export default function UserAttributeValueRoute() {
  // Remix bug
  return null;
}
