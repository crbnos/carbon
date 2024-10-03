import { error, success } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import { flash } from "@carbon/auth/session.server";
import { validationError, validator } from "@carbon/form";
import { tasks } from "@trigger.dev/sdk/v3";
import type { ActionFunctionArgs } from "@vercel/remix";
import { json } from "@vercel/remix";
import { resendInviteValidator } from "~/modules/users";
import { resendInvite } from "~/modules/users/users.server";
import { userAdminTask } from "~/trigger/user-admin";

// export const config = { runtime: "nodejs" };

export async function action({ request }: ActionFunctionArgs) {
  const { client, companyId } = await requirePermissions(request, {
    delete: "users",
  });

  const validation = await validator(resendInviteValidator).validate(
    await request.formData()
  );

  if (validation.error) {
    return validationError(validation.error);
  }

  const { users } = validation.data;

  if (users.length === 1) {
    const [userId] = users;
    const result = await resendInvite(client, userId);

    return json({}, await flash(request, result));
  } else {
    try {
      await tasks.batchTrigger(
        userAdminTask.id,
        users.map((id) => ({
          payload: {
            id,
            type: "resend",
            companyId,
          },
        }))
      );
      return json(
        {},
        await flash(request, success("Successfully added invites to queue"))
      );
    } catch (e) {
      return json(
        {},
        await flash(request, error(e, "Failed to reinvite users"))
      );
    }
  }
}
