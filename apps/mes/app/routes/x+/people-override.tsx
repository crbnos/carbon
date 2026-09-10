import { assertIsPost } from "@carbon/auth";
import { requirePermissions } from "@carbon/auth/auth.server";
import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { setPeopleOverride } from "~/services/people.server";

// Dismisses the people-assignment station default for the given date (session
// cookie); the operations loader stops defaulting the work-center filter.
export async function action({ request }: ActionFunctionArgs) {
  assertIsPost(request);
  await requirePermissions(request, {});

  const formData = await request.formData();
  const date = String(formData.get("date") ?? "");

  return data(
    { success: true },
    { headers: { "Set-Cookie": await setPeopleOverride(request, date) } }
  );
}
