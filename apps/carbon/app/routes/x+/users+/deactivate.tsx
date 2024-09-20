import { validationError, validator } from "@carbon/form";
import { tasks } from "@trigger.dev/sdk/v3";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import { deactivateUsersValidator } from "~/modules/users";
import { deactivateUser } from "~/modules/users/users.server";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import type { userAdminTask } from "~/trigger/user-admin";
import { safeRedirect } from "~/utils/http";
import { error, success } from "~/utils/result";

export const config = { runtime: "nodejs" };

export async function action({ request }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
    delete: "users",
  });

  const validation = await validator(deactivateUsersValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { users, redirectTo } = validation.data;

  if (users.length === 1) {
    const [userId] = users;
    const result = await deactivateUser(client, userId);

    throw redirect(safeRedirect(redirectTo), await flash(request, result));
  } else {
    const batchPayload = users.map((id) => ({
      payload: {
        id,
        type: "deactivate" as const,
      },
    }));

    try {
      await tasks.batchTrigger<typeof userAdminTask>(
        "user-admin",
        batchPayload
      );
      throw redirect(
        safeRedirect(redirectTo),
        await flash(
          request,
          success("Success. Please check back in a few moments.")
        )
      );
    } catch (e) {
      throw redirect(
        safeRedirect(redirectTo),
        await flash(request, error(e, "Failed to deactivate users"))
      );
    }
  }
}
