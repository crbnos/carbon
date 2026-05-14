import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { upsertModulePreferences } from "~/modules/users/users.server";

export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  const { client, userId, companyId } = await requirePermissions(request, {});

  const body = (await request.json()) as {
    preferences: { module: string; position: number; hidden: boolean }[];
  };

  if (!Array.isArray(body.preferences)) {
    return data({ error: "Invalid preferences format" }, { status: 400 });
  }

  const result = await upsertModulePreferences(
    client,
    userId,
    companyId,
    body.preferences
  );

  if (result.error) {
    return data({ error: result.error.message }, { status: 500 });
  }

  return data({ success: true });
}
