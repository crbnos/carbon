import { validationError, validator } from "@carbon/remix-validated-form";
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import type { z } from "zod";
import type { userAdminSchema } from "~/jobs/user-admin.server";
import { triggerClient } from "~/lib/trigger.server";
import { resendInviteValidator } from "~/modules/users";
import { resendInvite } from "~/modules/users/users.server";
import { requirePermissions } from "~/services/auth/auth.server";
import { flash } from "~/services/session.server";
import { error, success } from "~/utils/result";

export async function action({ request }: ActionFunctionArgs) {
  const { client } = await requirePermissions(request, {
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
    const jobs = users.map<{
      name: string;
      payload: z.infer<typeof userAdminSchema>;
    }>((id) => ({
      name: "user.admin",
      payload: {
        id,
        type: "resend",
      },
    }));

    try {
      await triggerClient.sendEvents(jobs);
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
