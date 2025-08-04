import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "@vercel/remix";
import { redirect } from "@vercel/remix";

export async function action({ request }: ActionFunctionArgs) {
  const { client, userId } = await requirePermissions(request, {});

  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const redirectTo = formData.get("redirectTo") as string | null;

  if (intent === "academy") {
    await client
      .from("user")
      .update({
        acknowledgedUniversity: true,
      })
      .eq("id", userId);

    if (redirectTo) {
      throw redirect(redirectTo);
    }
  }

  return null;
}
