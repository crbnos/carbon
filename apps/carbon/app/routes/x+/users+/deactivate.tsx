import { validationError, validator } from "@carbon/form";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";
import type { z } from "zod";
import type { userAdminSchema } from "~/jobs/user-admin.server";
import { triggerClient } from "~/lib/trigger.server";
import { deactivateUsersValidator } from "~/modules/users";
import { deactivateUser } from "~/modules/users/users.server";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
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
    const jobs = users.map<{
      name: string;
      payload: z.infer<typeof userAdminSchema>;
    }>((id) => ({
      name: "user.admin",
      payload: {
        id,
        type: "deactivate",
      },
    }));

    try {
      await triggerClient.sendEvents(jobs);
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
