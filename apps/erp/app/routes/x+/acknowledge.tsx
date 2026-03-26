import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { userFlagValidator } from "~/modules/users";

export async function action({ request }: ActionFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const redirectTo = formData.get("redirectTo") as string | null;

  // Keep ITAR handling unchanged — compliance blocker
  if (intent === "itar") {
    const updateResult = await client
      .from("user")
      .update({
        acknowledgedITAR: true
      })
      .eq("id", userId);

    if (updateResult.error) {
      return {
        success: false,
        message: "Failed to update ITAR acknowledgement"
      };
    }

    return { success: true, message: "ITAR acknowledged" };
  }

  // Generic flag handling — covers training dismissals and any future flags
  if (intent === "flag") {
    const parsed = userFlagValidator.safeParse({
      flag: formData.get("flag"),
      value: formData.get("value") === "true"
    });

    if (!parsed.success) {
      return { success: false, message: parsed.error.issues[0].message };
    }

    const { flag, value } = parsed.data;

    const { data: user, error: readError } = await client
      .from("user")
      .select("flags")
      .eq("id", userId)
      .single();

    if (readError) {
      console.error(
        `[acknowledge] Failed to read flags for user ${userId}:`,
        readError
      );
      return { success: false, message: "Failed to read user flags" };
    }

    const currentFlags = (user?.flags as Record<string, boolean> | null) ?? {};
    const updatedFlags = { ...currentFlags, [flag]: value };

    const updateResult = await client
      .from("user")
      .update({ flags: updatedFlags })
      .eq("id", userId);

    if (updateResult.error) {
      console.error(
        `[acknowledge] Failed to write flag "${flag}" for user ${userId}:`,
        updateResult.error
      );
      return { success: false, message: "Failed to update flag" };
    }

    if (redirectTo) {
      throw redirect(redirectTo);
    }

    return { success: true, message: "Flag updated" };
  }
}
